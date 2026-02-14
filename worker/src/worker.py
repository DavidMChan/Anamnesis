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
    ):
        """
        Initialize task processor.

        Args:
            db: Database client for fetching/updating data
            llm: LLM client for completions
            max_retries: Maximum retry attempts per task
        """
        self.db = db
        self.llm = llm
        self.max_retries = max_retries

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

            # Call LLM
            logger.debug(f"Asking question {i+1}/{len(questions)}: {question.qkey}")
            response = self.llm.complete(prompt)

            # Store result
            results[question.qkey] = response.answer
            logger.debug(f"Answer for {question.qkey}: {response.answer}")

            # Update context with this Q&A for next question
            context = append_answer_to_context(prompt, response.answer)

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
