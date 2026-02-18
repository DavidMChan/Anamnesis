"""
Task processor module - the core worker logic.

Follows anthology approach:
- Questions are asked in series with context accumulation
- LLM sees its previous answers when answering follow-up questions
- Uses Completions API for base models
"""
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
import logging

from .prompt import (
    Question,
    build_initial_prompt,
    build_followup_prompt,
    append_answer_to_context,
)
from .llm import BaseLLMClient, LLMResponse, RetryableError, NonRetryableError, LLMError
from .parser import ParserLLM


def match_option_text(response_text: str, options: List[str]) -> str:
    """
    Try to match option text in the response (anthology style).

    For example, if options are ["Very excited", "Somewhat excited", ...]
    and response is "I would be somewhat excited", this returns "B".

    Args:
        response_text: Raw LLM response
        options: List of option texts

    Returns:
        Letter (A, B, C, ...) if matched, empty string otherwise
    """
    import re

    if not options:
        return ""

    response_lower = response_text.lower()

    # Count matches for each option
    matches = []
    for idx, option in enumerate(options):
        option_lower = option.lower()
        if option_lower in response_lower:
            matches.append((idx, len(option)))  # (index, length for priority)

    # Return only if exactly one option matches (like anthology)
    if len(matches) == 1:
        return chr(65 + matches[0][0])  # A, B, C, ...

    return ""

logger = logging.getLogger(__name__)


@dataclass
class TaskProcessorResult:
    """Result of processing a single task."""
    success: bool
    task_id: str
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None


class TaskProcessor:
    """
    Processes survey tasks by calling LLM with backstory + questions.

    Uses context accumulation (in_series mode from anthology):
    - Questions are asked one at a time
    - Each question sees the previous Q&A pairs
    - Promotes consistency in responses
    """

    def __init__(
        self,
        db,  # DatabaseClient or mock
        llm: BaseLLMClient,
        max_retries: int = 3,
        parser_llm: Optional["ParserLLM"] = None,
    ):
        """
        Initialize task processor.

        Args:
            db: Database client for fetching/updating data
            llm: LLM client for completions
            max_retries: Maximum retry attempts per task
            parser_llm: Optional parser LLM for Tier 2 MCQ fallback
        """
        self.db = db
        self.llm = llm
        self.max_retries = max_retries
        self.parser_llm = parser_llm

    def fetch_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Fetch task details from database."""
        return self.db.get_task(task_id)

    def mark_processing(self, task_id: str) -> None:
        """Mark task as processing and increment attempts."""
        self.db.update_task_status(task_id, "processing")
        self.db.increment_task_attempts(task_id)

    def process_questions_in_series(
        self,
        backstory: str,
        questions: List[Question],
    ) -> Dict[str, str]:
        """
        Process questions in series with context accumulation.

        This follows anthology's in_series mode:
        1. Start with backstory + first question
        2. Get answer, append to context
        3. Add consistency prompt + next question
        4. Repeat until all questions answered

        Args:
            backstory: Backstory text
            questions: List of questions to answer

        Returns:
            Dict mapping qkey -> answer

        Raises:
            LLMError: If any LLM call fails
        """
        results: Dict[str, str] = {}
        context = ""

        for i, question in enumerate(questions):
            # Build prompt based on whether this is first question or follow-up
            if i == 0:
                prompt = build_initial_prompt(backstory, question)
            else:
                prompt = build_followup_prompt(context, question)

            # Compliance forcing: retry until we get a parseable answer (like anthology)
            max_compliance_retries = 10  # Anthology uses 100, we use 10 for now
            answer = ""
            raw_answer = ""

            for retry in range(max_compliance_retries):
                # Call LLM — pass question for guided decoding (Tier 1)
                if retry == 0:
                    logger.debug(f"Asking question {i+1}/{len(questions)}: {question.qkey}")
                else:
                    logger.debug(f"Compliance retry {retry}/{max_compliance_retries} for {question.qkey}")

                response = self.llm.complete(prompt, question=question)
                raw_answer = response.raw if response.raw else ""

                # Tier 1: guided decoding already parsed the answer
                answer = response.answer
                tier = ""

                if answer:
                    tier = "tier1_guided"

                # Open response: accept any non-empty text as valid, skip Tier 2/3
                if question.type == "open_response":
                    if answer:
                        tier = "tier1_text"
                        logger.info(f"[{tier}] {question.qkey}={repr(answer[:80])} (raw={repr(raw_answer[:80])})")
                        break
                    else:
                        # Empty response — retry (model produced nothing)
                        logger.warning(f"[parse_fail] {question.qkey} open_response empty, retrying")
                        continue

                # Tier 2: parser LLM fallback (MCQ, multiple_select, ranking)
                if not answer and question.type in ("mcq", "multiple_select", "ranking") and self.parser_llm and response.raw:
                    answer = self.parser_llm.parse(response.raw, question)
                    if answer:
                        tier = "tier2_parser"

                # Tier 3: option text matching (MCQ only — doesn't apply to multi-select/ranking)
                if not answer and question.type == "mcq" and question.options and response.raw:
                    answer = match_option_text(response.raw, question.options)
                    if answer:
                        tier = "tier3_regex"

                if answer:
                    logger.info(f"[{tier}] {question.qkey}={answer} (raw={repr(raw_answer[:80])})")
                else:
                    logger.warning(f"[parse_fail] {question.qkey} raw={repr(raw_answer[:80])}")

                # If we got a valid answer, break out of retry loop
                if answer:
                    break

            # Log if all retries failed
            if not answer:
                logger.warning(f"All {max_compliance_retries} retries failed for {question.qkey}, marking as non-compliant")

            # Store result
            results[question.qkey] = answer
            logger.info(f"Parsed answer for {question.qkey}: {answer} (raw: {repr(raw_answer[:100]) if raw_answer else 'None'})")

            # Update context with this Q&A for next question
            # Use raw answer like anthology does (model expects to see its full response)
            context = append_answer_to_context(prompt, raw_answer)

        return results

    def store_result(self, task_id: str, result: Dict[str, Any]) -> None:
        """
        Store task result and mark as completed.

        Args:
            task_id: UUID of the task
            result: Result data (qkey -> answer mapping)
        """
        self.db.update_task_result(task_id, result)
        self.db.update_task_status(task_id, "completed")

    def update_run_progress(
        self,
        run_id: str,
        backstory_id: str,
        result: Optional[Dict[str, Any]],
        success: bool,
    ) -> None:
        """
        Update survey run progress after task completion.

        Args:
            run_id: UUID of the survey run
            backstory_id: UUID of the processed backstory
            result: Task result (if successful)
            success: Whether task succeeded
        """
        if success and result:
            self.db.increment_completed_tasks(run_id)
            self.db.append_run_result(run_id, backstory_id, result)
        else:
            self.db.increment_failed_tasks(run_id)

        # Check if run is complete
        self.db.check_run_completion(run_id)

    def process_task(self, task_id: str) -> TaskProcessorResult:
        """
        Process a single survey task.

        Full flow:
        1. Fetch task from DB
        2. Mark as processing
        3. Get backstory and questions
        4. Call LLM
        5. Store result
        6. Update run progress

        Args:
            task_id: UUID of the task to process

        Returns:
            TaskProcessorResult indicating success/failure
        """
        # 1. Fetch task
        task = self.fetch_task(task_id)
        if not task:
            return TaskProcessorResult(
                success=False,
                task_id=task_id,
                error="Task not found",
            )

        run_id = task["survey_run_id"]
        backstory_id = task["backstory_id"]
        attempts = task.get("attempts", 0)

        try:
            # 2. Mark as processing
            self.mark_processing(task_id)

            # 3. Get backstory and questions
            backstory_data = self.db.get_backstory(backstory_id)
            if not backstory_data:
                raise ValueError(f"Backstory {backstory_id} not found")

            backstory_text = backstory_data.get("backstory_text", "")

            questions_data = self.db.get_survey_questions(run_id)
            if not questions_data:
                raise ValueError(f"No questions found for run {run_id}")

            questions = [Question.from_dict(q) for q in questions_data]

            # 4. Process questions in series (with context accumulation)
            logger.info(f"Processing {len(questions)} questions for backstory {backstory_id}")
            results = self.process_questions_in_series(backstory_text, questions)

            # 5. Store result
            self.store_result(task_id, results)

            # 6. Update run progress
            self.update_run_progress(run_id, backstory_id, results, success=True)

            return TaskProcessorResult(
                success=True,
                task_id=task_id,
                result=results,
            )

        except NonRetryableError as e:
            # Permanent failure - don't retry
            error_msg = str(e)
            self.db.update_task_error(task_id, error_msg)
            self.db.update_task_status(task_id, "failed")
            self.db.append_run_error(run_id, backstory_id, error_msg)
            self.update_run_progress(run_id, backstory_id, None, success=False)

            return TaskProcessorResult(
                success=False,
                task_id=task_id,
                error=error_msg,
            )

        except (RetryableError, LLMError, Exception) as e:
            # Check if we should retry
            error_msg = str(e)
            new_attempts = attempts + 1

            if new_attempts >= self.max_retries:
                # Max retries exceeded - mark as failed
                self.db.update_task_error(task_id, error_msg)
                self.db.update_task_status(task_id, "failed")
                self.db.append_run_error(run_id, backstory_id, error_msg)
                self.update_run_progress(run_id, backstory_id, None, success=False)

                return TaskProcessorResult(
                    success=False,
                    task_id=task_id,
                    error=error_msg,
                )
            else:
                # Can retry - revert to pending
                self.db.update_task_status(task_id, "pending")

                return TaskProcessorResult(
                    success=False,
                    task_id=task_id,
                    error=f"Will retry ({new_attempts}/{self.max_retries}): {error_msg}",
                )
