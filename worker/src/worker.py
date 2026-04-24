"""
Task processor module with strategy pattern for filling algorithms.

Follows anthology approach:
- Questions are asked in series with context accumulation
- LLM sees its previous answers when answering follow-up questions

Provides both sync and async interfaces:
- process_task() / process_questions_in_series() — sync (used by tests, simple scripts)
- async_process_task() / async_process_questions_in_series() — async (used by async worker)
"""
import asyncio
from dataclasses import dataclass
from typing import Optional, Dict, Any, List, Protocol, runtime_checkable
import logging

from .prompt import (
    Question,
    Prompt,
    build_initial_prompt,
    build_followup_prompt,
    append_answer_to_context,
    build_multimodal_prompt,
)
from .llm import UnifiedLLMClient
from .logprobs import parse_logprobs_to_distribution
from .media import WasabiMediaClient
from .response import LLMResponse, RetryableError, NonRetryableError
from .parser import ParserLLM

logger = logging.getLogger(__name__)
META_KEY = "__meta__"


def _empty_usage_totals() -> Dict[str, Any]:
    return {
        "api_calls": 0,
        "main_model_calls": 0,
        "parser_model_calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "reasoning_tokens": 0,
        "cached_tokens": 0,
        "cache_write_tokens": 0,
        "audio_tokens": 0,
        "cost": 0.0,
        "main_model_cost": 0.0,
        "parser_model_cost": 0.0,
    }


def _merge_usage(totals: Dict[str, Any], usage, source: str) -> None:
    if not usage:
        return

    totals["api_calls"] += 1
    if source == "main":
        totals["main_model_calls"] += 1
    elif source == "parser":
        totals["parser_model_calls"] += 1

    for key in (
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "reasoning_tokens",
        "cached_tokens",
        "cache_write_tokens",
        "audio_tokens",
    ):
        value = getattr(usage, key, None)
        if value is not None:
            totals[key] += value

    cost = getattr(usage, "cost", None)
    if cost is not None:
        totals["cost"] += cost
        if source == "main":
            totals["main_model_cost"] += cost
        elif source == "parser":
            totals["parser_model_cost"] += cost


def _combine_usage_totals(target: Dict[str, Any], delta: Dict[str, Any]) -> None:
    for key, value in delta.items():
        if isinstance(value, (int, float)):
            target[key] += value


def _build_task_metadata(llm: UnifiedLLMClient, parser_llm: Optional[ParserLLM], usage: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "llm": {
            "provider": getattr(llm, "provider", None),
            "model": getattr(llm, "model", None),
        },
        "parser_llm": (
            {"model": getattr(parser_llm, "model", None)}
            if parser_llm and getattr(parser_llm, "is_configured", False)
            else None
        ),
        "usage": {
            **usage,
            "cost": round(usage["cost"], 8),
            "main_model_cost": round(usage["main_model_cost"], 8),
            "parser_model_cost": round(usage["parser_model_cost"], 8),
        },
    }


# ─── Filling Strategy ────────────────────────────────────────────────────────


@runtime_checkable
class FillingStrategy(Protocol):
    """Protocol for survey filling algorithms."""

    async def fill(
        self,
        backstory: str,
        questions: List[Question],
        llm: UnifiedLLMClient,
        parser_llm: Optional[ParserLLM] = None,
        media_client: Optional[WasabiMediaClient] = None,
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fill all questions and return qkey -> answer mapping."""
        ...


class SeriesWithContext:
    """
    Anthology-style: questions asked sequentially with context accumulation.
    LLM sees its previous answers when answering follow-up questions.
    Two-tier parsing: structured output (Tier 1) + parser LLM fallback (Tier 2).
    """

    def __init__(self, max_compliance_retries: int = 10):
        self.max_compliance_retries = max_compliance_retries

    async def fill(
        self,
        backstory: str,
        questions: List[Question],
        llm: UnifiedLLMClient,
        parser_llm: Optional[ParserLLM] = None,
        media_client: Optional[WasabiMediaClient] = None,
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        results: Dict[str, Any] = {}
        context = ""
        short_id = (task_id or "")[:8]
        task_usage = _empty_usage_totals()

        llm_max_tokens = getattr(llm, "max_tokens", None)
        open_response_max_words = int(llm_max_tokens * 2 / 3) if isinstance(llm_max_tokens, (int, float)) else None

        for i, question in enumerate(questions):
            max_words = open_response_max_words if question.type == "open_response" else None
            if i == 0:
                text_prompt = build_initial_prompt(backstory, question, max_words=max_words)
            else:
                text_prompt = build_followup_prompt(context, question, max_words=max_words)

            # Download media and build multimodal prompt if needed
            question_media = None
            if question.has_media:
                if not media_client:
                    raise NonRetryableError(
                        f"Question '{question.qkey}' has media attachments but Wasabi storage "
                        "is not configured. Add WASABI_ACCESS_KEY_ID, WASABI_SECRET_ACCESS_KEY, "
                        "and WASABI_BUCKET to .env."
                    )
                question_media = await asyncio.to_thread(
                    media_client.download_media_for_question, question
                )

            prompt: Prompt = build_multimodal_prompt(text_prompt, question_media)

            answer, raw, question_usage = await self._ask_with_retry(
                prompt, question, llm, parser_llm, label=f"{short_id}/{question.qkey}"
            )
            results[question.qkey] = answer
            _combine_usage_totals(task_usage, question_usage)
            # Context accumulation stays text-only (no re-sending images)
            context = append_answer_to_context(text_prompt, raw)

        results[META_KEY] = _build_task_metadata(llm, parser_llm, task_usage)
        return results

    async def _ask_with_retry(
        self,
        prompt: Prompt,
        question: Question,
        llm: UnifiedLLMClient,
        parser_llm: Optional[ParserLLM],
        label: str = "",
    ) -> tuple[str, str, Dict[str, Any]]:
        """Ask question with compliance retries + Tier 1/2 parsing."""
        raw = ""
        tag = f"[{label}]" if label else f"[{question.qkey}]"
        usage_totals = _empty_usage_totals()
        for retry in range(self.max_compliance_retries):
            if retry > 0:
                logger.debug(f"{tag} compliance retry {retry}/{self.max_compliance_retries}")

            response = await llm.async_complete(prompt, question=question)
            raw = response.raw or ""
            answer = response.answer
            tier = ""
            _merge_usage(usage_totals, response.usage, "main")

            if answer:
                tier = "tier1_guided"

            # Open response: accept any non-empty text, skip Tier 2
            if question.type == "open_response":
                if answer:
                    tier = "tier1_text"
                    logger.info(f"{tag} [{tier}] answer={repr(answer)}")
                    return answer, raw, usage_totals
                else:
                    logger.warning(f"{tag} [parse_fail] open_response empty, retrying")
                    continue

            # Tier 2: parser LLM fallback (MCQ, multiple_select, ranking)
            if not answer and question.type in ("mcq", "multiple_select", "ranking") and parser_llm and raw:
                parser_response = await parser_llm.async_parse_response(raw, question)
                _merge_usage(usage_totals, parser_response.usage, "parser")
                answer = parser_response.answer
                if answer:
                    tier = "tier2_parser"

            if answer:
                logger.info(f"{tag} [{tier}] answer={answer} raw={repr(raw)}")
                return answer, raw, usage_totals
            else:
                logger.warning(f"{tag} [parse_fail] raw={repr(raw)}")

        logger.warning(f"{tag} all {self.max_compliance_retries} retries failed, marking as non-compliant")
        return "", raw, usage_totals


class IndependentRepeat:
    """
    N-sample mode for demographic surveys: asks a single question N times
    independently (NO context accumulation between trials).

    Returns all N raw answers for aggregation into a frequency distribution.
    """

    def __init__(self, num_trials: int = 20, max_compliance_retries: int = 10):
        self.num_trials = num_trials
        self.max_compliance_retries = max_compliance_retries

    async def fill(
        self,
        backstory: str,
        questions: List[Question],
        llm: UnifiedLLMClient,
        parser_llm: Optional[ParserLLM] = None,
        media_client: Optional[WasabiMediaClient] = None,
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Ask each question N times independently. Returns a special result:
        {qkey: "answer1||answer2||...||answerN"} with all N raw answers
        joined by '||' for downstream distribution computation.
        """
        results: Dict[str, Any] = {}
        short_id = (task_id or "")[:8]
        task_usage = _empty_usage_totals()

        for question in questions:
            answers: List[str] = []
            for trial in range(self.num_trials):
                # Each trial is independent — fresh prompt, no context
                text_prompt = build_initial_prompt(backstory, question)

                # Download media if needed
                question_media = None
                if question.has_media:
                    if not media_client:
                        raise NonRetryableError(
                            f"Question '{question.qkey}' has media but Wasabi is not configured."
                        )
                    question_media = await asyncio.to_thread(
                        media_client.download_media_for_question, question
                    )

                prompt: Prompt = build_multimodal_prompt(text_prompt, question_media)
                label = f"{short_id}/{question.qkey}#{trial}"
                answer, _, trial_usage = await self._ask_with_retry(
                    prompt, question, llm, parser_llm, trial, label=label
                )
                answers.append(answer)
                _combine_usage_totals(task_usage, trial_usage)

            results[question.qkey] = "||".join(answers)
            logger.info(f"[{short_id}/{question.qkey}] collected {len(answers)} answers")

        results[META_KEY] = _build_task_metadata(llm, parser_llm, task_usage)
        return results

    async def _ask_with_retry(
        self,
        prompt: Prompt,
        question: Question,
        llm: UnifiedLLMClient,
        parser_llm: Optional[ParserLLM],
        trial: int,
        label: str = "",
    ) -> tuple[str, str, Dict[str, Any]]:
        """Ask question with compliance retries + Tier 1/2 parsing."""
        raw = ""
        tag = f"[{label}]" if label else f"[{question.qkey}#{trial}]"
        usage_totals = _empty_usage_totals()
        for retry in range(self.max_compliance_retries):
            if retry > 0:
                logger.debug(f"{tag} compliance retry {retry}/{self.max_compliance_retries}")

            response = await llm.async_complete(prompt, question=question)
            raw = response.raw or ""
            answer = response.answer
            _merge_usage(usage_totals, response.usage, "main")

            # Open response: accept any non-empty text
            if question.type == "open_response":
                if answer:
                    return answer, raw, usage_totals
                continue

            # Tier 2: parser LLM fallback
            if not answer and question.type in ("mcq", "multiple_select", "ranking") and parser_llm and raw:
                parser_response = await parser_llm.async_parse_response(raw, question)
                _merge_usage(usage_totals, parser_response.usage, "parser")
                answer = parser_response.answer

            if answer:
                logger.debug(f"{tag} answer={answer} raw={repr(raw)}")
                return answer, raw, usage_totals

        logger.warning(f"{tag} all retries failed")
        return "", raw, usage_totals


class LogprobsSingle:
    """
    Logprobs mode for demographic surveys: asks each MCQ question once with
    logprobs=True and computes the probability distribution from token
    log-probabilities. ~20x cheaper than IndependentRepeat.

    Only supports MCQ questions (raises NonRetryableError for other types).
    Returns {qkey: JSON_string_of_letter_distribution} e.g. '{"A": 0.72, "B": 0.28}'.
    """

    async def fill(
        self,
        backstory: str,
        questions: List[Question],
        llm: UnifiedLLMClient,
        parser_llm: Optional[ParserLLM] = None,
        media_client: Optional[WasabiMediaClient] = None,
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        import json
        results: Dict[str, Any] = {}

        for question in questions:
            if question.type != "mcq":
                raise NonRetryableError(
                    f"LogprobsSingle only supports MCQ questions, got type='{question.type}' "
                    f"for question '{question.qkey}'"
                )

            text_prompt = build_initial_prompt(backstory, question)
            logprobs_result = await llm.async_complete_logprobs(text_prompt)

            num_options = len(question.options) if question.options else 0
            if num_options == 0:
                raise NonRetryableError(
                    f"LogprobsSingle requires MCQ options, but question '{question.qkey}' has none"
                )

            distribution = parse_logprobs_to_distribution(
                logprobs_result.top_logprobs, num_options
            )
            results[question.qkey] = json.dumps(distribution)
            logger.info(
                f"LogprobsSingle: {question.qkey} distribution={distribution} "
                f"(generated_token={logprobs_result.generated_token!r})"
            )

        results[META_KEY] = _build_task_metadata(llm, parser_llm, _empty_usage_totals())
        return results


# ─── TaskProcessor ────────────────────────────────────────────────────────────


@dataclass
class TaskProcessorResult:
    """Result of processing a single task."""
    success: bool
    task_id: str
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None


class TaskProcessor:
    """
    Processes survey tasks using a pluggable filling strategy.

    Uses context accumulation (in_series mode from anthology):
    - Questions are asked one at a time
    - Each question sees the previous Q&A pairs
    - Promotes consistency in responses
    """

    def __init__(
        self,
        db,  # DatabaseClient or mock
        llm: UnifiedLLMClient,
        max_retries: int = 3,
        parser_llm: Optional[ParserLLM] = None,
        strategy: Optional[FillingStrategy] = None,
        media_client: Optional[WasabiMediaClient] = None,
    ):
        self.db = db
        self.llm = llm
        self.max_retries = max_retries
        self.parser_llm = parser_llm
        self.strategy = strategy or SeriesWithContext()
        self.media_client = media_client

    def fetch_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Fetch task details from database."""
        return self.db.get_task(task_id)

    def process_questions_in_series(
        self,
        backstory: str,
        questions: List[Question],
    ) -> Dict[str, Any]:
        """
        Process questions in series with context accumulation (sync).

        This follows anthology's in_series mode:
        1. Start with backstory + first question
        2. Get answer, append to context
        3. Add consistency prompt + next question
        4. Repeat until all questions answered

        Two-tier parsing: structured output (Tier 1) + parser LLM fallback (Tier 2).
        """
        results: Dict[str, Any] = {}
        context = ""
        task_usage = _empty_usage_totals()

        llm_max_tokens = getattr(self.llm, "max_tokens", None)
        open_response_max_words = int(llm_max_tokens * 2 / 3) if isinstance(llm_max_tokens, (int, float)) else None

        for i, question in enumerate(questions):
            max_words = open_response_max_words if question.type == "open_response" else None
            if i == 0:
                text_prompt = build_initial_prompt(backstory, question, max_words=max_words)
            else:
                text_prompt = build_followup_prompt(context, question, max_words=max_words)

            # Download media and build multimodal prompt if needed
            question_media = None
            if question.has_media and self.media_client:
                question_media = self.media_client.download_media_for_question(question)

            prompt: Prompt = build_multimodal_prompt(text_prompt, question_media)

            # Compliance forcing: retry until we get a parseable answer
            max_compliance_retries = 10
            answer = ""
            raw_answer = ""

            for retry in range(max_compliance_retries):
                if retry == 0:
                    logger.debug(f"Asking question {i+1}/{len(questions)}: {question.qkey}")
                else:
                    logger.debug(f"Compliance retry {retry}/{max_compliance_retries} for {question.qkey}")

                response = self.llm.complete(prompt, question=question)
                raw_answer = response.raw if response.raw else ""
                _merge_usage(task_usage, response.usage, "main")

                answer = response.answer
                tier = ""

                if answer:
                    tier = "tier1_guided"

                # Open response: accept any non-empty text
                if question.type == "open_response":
                    if answer:
                        tier = "tier1_text"
                        logger.info(f"[{tier}] {question.qkey}={repr(answer)}")
                        break
                    else:
                        logger.warning(f"[parse_fail] {question.qkey} open_response empty, retrying")
                        continue

                # Tier 2: parser LLM fallback (MCQ, multiple_select, ranking)
                if not answer and question.type in ("mcq", "multiple_select", "ranking") and self.parser_llm and response.raw:
                    parser_response = self.parser_llm.parse_response(response.raw, question)
                    _merge_usage(task_usage, parser_response.usage, "parser")
                    answer = parser_response.answer
                    if answer:
                        tier = "tier2_parser"

                if answer:
                    logger.info(f"[{tier}] {question.qkey}={answer} raw={repr(raw_answer)}")
                else:
                    logger.warning(f"[parse_fail] {question.qkey} raw={repr(raw_answer)}")

                if answer:
                    break

            if not answer:
                logger.warning(f"All {max_compliance_retries} retries failed for {question.qkey}, marking as non-compliant")

            results[question.qkey] = answer

            # Context accumulation stays text-only (no re-sending images)
            context = append_answer_to_context(text_prompt, raw_answer)

        results[META_KEY] = _build_task_metadata(self.llm, self.parser_llm, task_usage)
        return results

    def store_result(self, task_id: str, result: Dict[str, Any]) -> bool:
        """Atomically store task result and mark as completed."""
        return self.db.complete_task(task_id, result)

    def process_task(self, task_id: str) -> TaskProcessorResult:
        """
        Process a single survey task (sync version).

        Flow:
        1. Start task (set processing + increment attempts)
        2. Fetch task metadata
        3. Check max retries
        4. Get backstory and questions
        5. Call LLM
        6. Complete task atomically
        """
        # 1. Start task
        attempts = self.db.start_task(task_id)

        # 2. Fetch task metadata
        task = self.fetch_task(task_id)
        if not task:
            return TaskProcessorResult(
                success=False,
                task_id=task_id,
                error="Task not found",
            )

        run_id = task["survey_run_id"]
        backstory_id = task["backstory_id"]

        # 3. Check max retries
        if attempts > self.max_retries:
            error_msg = f"Max retries ({self.max_retries}) exceeded"
            self.db.fail_task(task_id, error_msg)
            return TaskProcessorResult(
                success=False,
                task_id=task_id,
                error=error_msg,
            )

        try:
            # 4. Get backstory and questions
            backstory_data = self.db.get_backstory(backstory_id)
            if not backstory_data:
                raise NonRetryableError(f"Backstory {backstory_id} not found")

            backstory_text = backstory_data.get("backstory_text", "")

            questions_data = self.db.get_survey_questions(run_id)
            if not questions_data:
                raise NonRetryableError(f"No questions found for run {run_id}")

            questions = [Question.from_dict(q) for q in questions_data]

            # 5. Process questions in series (with context accumulation)
            logger.info(f"Processing {len(questions)} questions for backstory {backstory_id}")
            results = self.process_questions_in_series(backstory_text, questions)

            # 6. Complete task atomically
            self.store_result(task_id, results)

            return TaskProcessorResult(
                success=True,
                task_id=task_id,
                result=results,
            )

        except NonRetryableError as e:
            self.db.fail_task(task_id, str(e))
            return TaskProcessorResult(
                success=False,
                task_id=task_id,
                error=str(e),
            )

        except Exception as e:
            return TaskProcessorResult(
                success=False,
                task_id=task_id,
                error=str(e),
            )

    # ==================== Async Methods ====================

    async def async_process_questions_in_series(
        self,
        backstory: str,
        questions: List[Question],
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Async version — delegates to the filling strategy.

        Questions are still processed sequentially (context accumulation),
        but LLM calls use async I/O to avoid blocking the event loop.
        """
        return await self.strategy.fill(backstory, questions, self.llm, self.parser_llm, self.media_client, task_id=task_id)

    async def async_process_task(self, task: Dict[str, Any]) -> TaskProcessorResult:
        """
        Async version of process_task.

        Caller (handle_message) is responsible for:
        - Fetching the task
        - Calling start_task / checking max retries
        - Retry decisions (nack vs ack)

        This method just processes the task and completes it.
        Errors propagate to the caller for retry/fail decisions.
        """
        task_id = task["id"]
        run_id = task["survey_run_id"]
        backstory_id = task.get("backstory_id")  # None for zero_shot_baseline

        if backstory_id:
            backstory_data = await asyncio.to_thread(self.db.get_backstory, backstory_id)
            if not backstory_data:
                raise NonRetryableError(f"Backstory {backstory_id} not found")
            backstory_text = backstory_data.get("backstory_text", "")
        else:
            # zero_shot_baseline: handle_message pre-builds and injects the prompt text
            backstory_text = task.get("zero_shot_prompt_text", "")

        questions_data = await asyncio.to_thread(self.db.get_survey_questions, run_id)
        if not questions_data:
            raise NonRetryableError(f"No questions found for run {run_id}")

        questions = [Question.from_dict(q) for q in questions_data]

        # Process questions using strategy
        logger.info(f"Processing {len(questions)} questions for backstory {backstory_id}")
        results = await self.async_process_questions_in_series(backstory_text, questions, task_id=task_id)

        # Complete task atomically
        await asyncio.to_thread(self.store_result, task_id, results)

        return TaskProcessorResult(
            success=True,
            task_id=task_id,
            result=results,
        )
