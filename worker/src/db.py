"""
Database operations module using Supabase.
"""
from typing import Optional, Dict, Any, List
from supabase import create_client, Client
from .config import SupabaseConfig


class DatabaseClient:
    """Supabase database client for worker operations."""

    def __init__(self, config: Optional[SupabaseConfig] = None):
        """
        Initialize database client.

        Args:
            config: Supabase configuration. If None, uses defaults from env.
        """
        if config is None:
            config = SupabaseConfig()
        self.client: Client = create_client(config.url, config.service_key)

    # ==================== Task Operations ====================

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a survey task by ID.

        Args:
            task_id: UUID of the task

        Returns:
            Task record or None if not found
        """
        result = (
            self.client.table("survey_tasks")
            .select("*")
            .eq("id", task_id)
            .single()
            .execute()
        )
        return result.data if result.data else None

    def get_pending_tasks(self, run_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get pending tasks for a survey run.

        Args:
            run_id: UUID of the survey run
            limit: Maximum number of tasks to return

        Returns:
            List of pending task records
        """
        result = (
            self.client.table("survey_tasks")
            .select("*")
            .eq("survey_run_id", run_id)
            .eq("status", "pending")
            .limit(limit)
            .execute()
        )
        return result.data or []

    def update_task_status(self, task_id: str, status: str) -> None:
        """
        Update task status.

        Args:
            task_id: UUID of the task
            status: New status ('pending', 'processing', 'completed', 'failed')
        """
        update_data = {"status": status}
        if status == "completed" or status == "failed":
            update_data["processed_at"] = "now()"

        self.client.table("survey_tasks").update(update_data).eq("id", task_id).execute()

    def update_task_result(self, task_id: str, result: Dict[str, Any]) -> None:
        """
        Store task result.

        Args:
            task_id: UUID of the task
            result: Result data (qkey -> answer mapping)
        """
        self.client.table("survey_tasks").update({"result": result}).eq("id", task_id).execute()

    def update_task_error(self, task_id: str, error: str) -> None:
        """
        Store task error message.

        Args:
            task_id: UUID of the task
            error: Error message
        """
        self.client.table("survey_tasks").update({"error": error}).eq("id", task_id).execute()

    def increment_task_attempts(self, task_id: str) -> None:
        """
        Increment the attempt counter for a task.

        Args:
            task_id: UUID of the task
        """
        # Fetch current attempts
        task = self.get_task(task_id)
        if task:
            new_attempts = (task.get("attempts") or 0) + 1
            self.client.table("survey_tasks").update({"attempts": new_attempts}).eq("id", task_id).execute()

    # ==================== Backstory Operations ====================

    def get_backstory(self, backstory_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a backstory by ID.

        Args:
            backstory_id: UUID of the backstory

        Returns:
            Backstory record or None if not found
        """
        result = (
            self.client.table("backstories")
            .select("*")
            .eq("id", backstory_id)
            .single()
            .execute()
        )
        return result.data if result.data else None

    # ==================== Survey Run Operations ====================

    def get_survey_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a survey run by ID.

        Args:
            run_id: UUID of the survey run

        Returns:
            Survey run record or None if not found
        """
        result = (
            self.client.table("survey_runs")
            .select("*")
            .eq("id", run_id)
            .single()
            .execute()
        )
        return result.data if result.data else None

    def get_survey_questions(self, run_id: str) -> List[Dict[str, Any]]:
        """
        Get questions for a survey run.

        Args:
            run_id: UUID of the survey run

        Returns:
            List of question objects
        """
        # First get the run to find the survey_id
        run = self.get_survey_run(run_id)
        if not run:
            return []

        survey_id = run.get("survey_id")
        if not survey_id:
            return []

        # Get the survey
        result = (
            self.client.table("surveys")
            .select("questions")
            .eq("id", survey_id)
            .single()
            .execute()
        )

        if result.data:
            return result.data.get("questions", [])
        return []

    def update_run_status(self, run_id: str, status: str) -> None:
        """
        Update survey run status.

        Args:
            run_id: UUID of the run
            status: New status
        """
        update_data = {"status": status}
        if status == "running":
            update_data["started_at"] = "now()"
        elif status in ("completed", "failed", "cancelled"):
            update_data["completed_at"] = "now()"

        self.client.table("survey_runs").update(update_data).eq("id", run_id).execute()

    def increment_completed_tasks(self, run_id: str) -> None:
        """
        Atomically increment completed_tasks counter.

        Args:
            run_id: UUID of the survey run
        """
        # Use RPC function for atomic increment
        self.client.rpc("increment_completed_tasks", {"run_id": run_id}).execute()

    def increment_failed_tasks(self, run_id: str) -> None:
        """
        Atomically increment failed_tasks counter.

        Args:
            run_id: UUID of the survey run
        """
        self.client.rpc("increment_failed_tasks", {"run_id": run_id}).execute()

    def append_run_result(
        self,
        run_id: str,
        backstory_id: str,
        result: Dict[str, Any],
    ) -> None:
        """
        Append task result to survey_runs.results.

        Args:
            run_id: UUID of the survey run
            backstory_id: UUID of the backstory
            result: Result data for this backstory
        """
        self.client.rpc(
            "append_run_result",
            {"run_id": run_id, "backstory_uuid": backstory_id, "task_result": result},
        ).execute()

    def append_run_error(
        self,
        run_id: str,
        backstory_id: str,
        error: str,
    ) -> None:
        """
        Append error to survey_runs.error_log.

        Args:
            run_id: UUID of the survey run
            backstory_id: UUID of the backstory
            error: Error message
        """
        self.client.rpc(
            "append_run_error",
            {"run_id": run_id, "backstory_uuid": backstory_id, "error_msg": error},
        ).execute()

    def check_run_completion(self, run_id: str) -> None:
        """
        Check if run is complete and update status accordingly.

        Args:
            run_id: UUID of the survey run
        """
        self.client.rpc("check_run_completion", {"run_id": run_id}).execute()

    # ==================== Survey Run Creation ====================

    def create_survey_run(
        self,
        survey_id: str,
        llm_config: Dict[str, Any],
        backstory_ids: List[str],
    ) -> str:
        """
        Create a new survey run with tasks.

        Args:
            survey_id: UUID of the survey
            llm_config: LLM configuration snapshot
            backstory_ids: List of backstory UUIDs to process

        Returns:
            UUID of the created survey run
        """
        # Create the run
        run_result = (
            self.client.table("survey_runs")
            .insert({
                "survey_id": survey_id,
                "status": "pending",
                "total_tasks": len(backstory_ids),
                "llm_config": llm_config,
            })
            .execute()
        )

        run_id = run_result.data[0]["id"]

        # Create tasks for each backstory
        tasks = [
            {"survey_run_id": run_id, "backstory_id": bid}
            for bid in backstory_ids
        ]
        self.client.table("survey_tasks").insert(tasks).execute()

        return run_id

    def get_backstory_ids_for_survey(
        self,
        survey_id: str,
        demographic_filter: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        """
        Get backstory IDs matching survey criteria.

        Args:
            survey_id: UUID of the survey (to get demographic filter)
            demographic_filter: Optional demographic filter to apply

        Returns:
            List of backstory UUIDs
        """
        # For now, return all public backstories
        # TODO: Implement demographic filtering when backstories have demographics
        result = (
            self.client.table("backstories")
            .select("id")
            .eq("is_public", True)
            .execute()
        )

        return [row["id"] for row in (result.data or [])]

    # ==================== Dispatcher Operations ====================

    def get_runs_needing_dispatch(self) -> List[Dict[str, Any]]:
        """
        Get survey runs that have pending tasks needing dispatch.

        Returns runs that are:
        - status = 'pending' (just created, not started)
        - status = 'running' but have pending tasks (retry scenario)

        Returns:
            List of survey run records
        """
        # Get runs with status 'pending' (newly created)
        result = (
            self.client.table("survey_runs")
            .select("*")
            .eq("status", "pending")
            .execute()
        )
        return result.data or []

    def get_pending_tasks_for_dispatch(self, run_id: str) -> List[Dict[str, Any]]:
        """
        Get all pending tasks for a run (for dispatching to queue).

        Unlike get_pending_tasks, this returns ALL pending tasks without limit.

        Args:
            run_id: UUID of the survey run

        Returns:
            List of pending task records
        """
        result = (
            self.client.table("survey_tasks")
            .select("id, backstory_id")
            .eq("survey_run_id", run_id)
            .eq("status", "pending")
            .execute()
        )
        return result.data or []
