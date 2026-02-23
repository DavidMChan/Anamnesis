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
from .media import WasabiMediaClient
from .response import LLMResponse, RetryableError, NonRetryableError
from .parser import ParserLLM

logger = logging.getLogger(__name__)


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
    ) -> Dict[str, str]:
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
    ) -> Dict[str, str]:
        results: Dict[str, str] = {}
        context = ""

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

            answer, raw = await self._ask_with_retry(prompt, question, llm, parser_llm)
            results[question.qkey] = answer
            # Context accumulation stays text-only (no re-sending images)
            context = append_answer_to_context(text_prompt, raw)

        return results

    async def _ask_with_retry(
        self,
        prompt: Prompt,
        question: Question,
        llm: UnifiedLLMClient,
        parser_llm: Optional[ParserLLM],
    ) -> tuple:
        """Ask question with compliance retries + Tier 1/2 parsing."""
        raw = ""
        for retry in range(self.max_compliance_retries):
            if retry == 0:
                logger.debug(f"Asking question: {question.qkey}")
            else:
                logger.debug(f"Compliance retry {retry}/{self.max_compliance_retries} for {question.qkey}")

            response = await llm.async_complete(prompt, question=question)
            raw = response.raw or ""
            answer = response.answer
            tier = ""

            if answer:
                tier = "tier1_guided"

            # Open response: accept any non-empty text, skip Tier 2
            if question.type == "open_response":
                if answer:
                    tier = "tier1_text"
                    logger.info(f"[{tier}] {question.qkey}={repr(answer[:80])}")
                    return answer, raw
                else:
                    logger.warning(f"[parse_fail] {question.qkey} open_response empty, retrying")
                    continue

            # Tier 2: parser LLM fallback (MCQ, multiple_select, ranking)
            if not answer and question.type in ("mcq", "multiple_select", "ranking") and parser_llm and raw:
                answer = await parser_llm.async_parse(raw, question)
                if answer:
                    tier = "tier2_parser"

            if answer:
                logger.info(f"[{tier}] {question.qkey}={answer} (raw={repr(raw[:80])})")
                return answer, raw
            else:
                logger.warning(f"[parse_fail] {question.qkey} raw={repr(raw[:80])}")

        logger.warning(f"All {self.max_compliance_retries} retries failed for {question.qkey}, marking as non-compliant")
        return "", raw


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
    ) -> Dict[str, str]:
        """
        Process questions in series with context accumulation (sync).

        This follows anthology's in_series mode:
        1. Start with backstory + first question
        2. Get answer, append to context
        3. Add consistency prompt + next question
        4. Repeat until all questions answered

        Two-tier parsing: structured output (Tier 1) + parser LLM fallback (Tier 2).
        """
        results: Dict[str, str] = {}
        context = ""

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

                answer = response.answer
                tier = ""

                if answer:
                    tier = "tier1_guided"

                # Open response: accept any non-empty text
                if question.type == "open_response":
                    if answer:
                        tier = "tier1_text"
                        logger.info(f"[{tier}] {question.qkey}={repr(answer[:80])} (raw={repr(raw_answer[:80])})")
                        break
                    else:
                        logger.warning(f"[parse_fail] {question.qkey} open_response empty, retrying")
                        continue

                # Tier 2: parser LLM fallback (MCQ, multiple_select, ranking)
                if not answer and question.type in ("mcq", "multiple_select", "ranking") and self.parser_llm and response.raw:
                    answer = self.parser_llm.parse(response.raw, question)
                    if answer:
                        tier = "tier2_parser"

                if answer:
                    logger.info(f"[{tier}] {question.qkey}={answer} (raw={repr(raw_answer[:80])})")
                else:
                    logger.warning(f"[parse_fail] {question.qkey} raw={repr(raw_answer[:80])}")

                if answer:
                    break

            if not answer:
                logger.warning(f"All {max_compliance_retries} retries failed for {question.qkey}, marking as non-compliant")

            results[question.qkey] = answer
            logger.info(f"Parsed answer for {question.qkey}: {answer} (raw: {repr(raw_answer[:100]) if raw_answer else 'None'})")

            # Context accumulation stays text-only (no re-sending images)
            context = append_answer_to_context(text_prompt, raw_answer)

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
    ) -> Dict[str, str]:
        """
        Async version — delegates to the filling strategy.

        Questions are still processed sequentially (context accumulation),
        but LLM calls use async I/O to avoid blocking the event loop.
        """
        return await self.strategy.fill(backstory, questions, self.llm, self.parser_llm, self.media_client)

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
        backstory_id = task["backstory_id"]

        # Get backstory and questions
        backstory_data = await asyncio.to_thread(self.db.get_backstory, backstory_id)
        if not backstory_data:
            raise NonRetryableError(f"Backstory {backstory_id} not found")

        backstory_text = backstory_data.get("backstory_text", "")

        questions_data = await asyncio.to_thread(self.db.get_survey_questions, run_id)
        if not questions_data:
            raise NonRetryableError(f"No questions found for run {run_id}")

        questions = [Question.from_dict(q) for q in questions_data]

        # Process questions using strategy
        logger.info(f"Processing {len(questions)} questions for backstory {backstory_id}")
        results = await self.async_process_questions_in_series(backstory_text, questions)

        # Complete task atomically
        await asyncio.to_thread(self.store_result, task_id, results)

        return TaskProcessorResult(
            success=True,
            task_id=task_id,
            result=results,
        )
