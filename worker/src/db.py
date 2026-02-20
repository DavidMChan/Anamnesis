"""
Database operations module using Supabase.
"""
from typing import Optional, Dict, Any, List
from supabase import create_client, Client
from postgrest.exceptions import APIError
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

    @staticmethod
    def _safe_single_execute(query):
        """Execute a .single() query, returning None instead of raising on 0 rows."""
        try:
            result = query.single().execute()
            return result.data if result.data else None
        except APIError as e:
            if e.code == "PGRST116":  # 0 rows — record was deleted
                return None
            raise

    # ==================== Task Operations ====================

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a survey task by ID.

        Args:
            task_id: UUID of the task

        Returns:
            Task record or None if not found
        """
        return self._safe_single_execute(
            self.client.table("survey_tasks")
            .select("*")
            .eq("id", task_id)
        )

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

    def increment_task_attempts(self, task_id: str) -> int:
        """
        Atomically increment the attempt counter for a task.

        Args:
            task_id: UUID of the task

        Returns:
            The new attempt count.

        Raises:
            RuntimeError: If the RPC call fails.
        """
        result = self.client.rpc(
            "increment_task_attempts",
            {"task_id": task_id}
        ).execute()

        if hasattr(result, 'error') and result.error:
            raise RuntimeError(f"Failed to increment task attempts: {result.error}")

        return result.data if result.data else 0

    def claim_task(self, task_id: str) -> bool:
        """
        Atomically claim a task for processing.

        Only succeeds if task is in 'pending' or 'queued' state.
        This prevents duplicate processing when multiple workers
        receive the same message from RabbitMQ.

        Args:
            task_id: UUID of the task

        Returns:
            True if claimed, False if already claimed by another worker.
        """
        result = self.client.rpc(
            "claim_task",
            {"p_task_id": task_id}
        ).execute()
        return bool(result.data)

    def complete_task(self, task_id: str, result: dict) -> bool:
        """
        Atomically mark task as completed with result.

        Only succeeds if task is in 'processing' state.

        Args:
            task_id: UUID of the task
            result: Result data (qkey -> answer mapping)

        Returns:
            True if completed, False if task was not in 'processing' state.
        """
        rpc_result = self.client.rpc(
            "complete_task",
            {"p_task_id": task_id, "p_result": result}
        ).execute()
        return bool(rpc_result.data)

    def fail_task(self, task_id: str, error: str) -> bool:
        """
        Atomically mark task as failed with error message.

        Only succeeds if task is in 'processing' state.

        Args:
            task_id: UUID of the task
            error: Error message

        Returns:
            True if marked failed, False if task was not in 'processing' state.
        """
        rpc_result = self.client.rpc(
            "fail_task",
            {"p_task_id": task_id, "p_error": error}
        ).execute()
        return bool(rpc_result.data)

    # ==================== Backstory Operations ====================

    def get_backstory(self, backstory_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a backstory by ID.

        Args:
            backstory_id: UUID of the backstory

        Returns:
            Backstory record or None if not found
        """
        return self._safe_single_execute(
            self.client.table("backstories")
            .select("*")
            .eq("id", backstory_id)
        )

    # ==================== Survey Run Operations ====================

    def get_survey_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a survey run by ID.

        Args:
            run_id: UUID of the survey run

        Returns:
            Survey run record or None if not found
        """
        return self._safe_single_execute(
            self.client.table("survey_runs")
            .select("*")
            .eq("id", run_id)
        )

    def get_survey_questions(self, run_id: str) -> List[Dict[str, Any]]:
        """
        Get questions for a survey run.

        Uses a single query with join to avoid N+1 pattern.

        Args:
            run_id: UUID of the survey run

        Returns:
            List of question objects
        """
        # Single query joining survey_runs -> surveys
        data = self._safe_single_execute(
            self.client.table("survey_runs")
            .select("surveys(questions)")
            .eq("id", run_id)
        )

        if not data:
            return []

        surveys_data = data.get("surveys")
        if not surveys_data:
            return []

        return surveys_data.get("questions", [])

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

        Raises:
            RuntimeError: If the RPC call fails.
        """
        result = self.client.rpc("increment_completed_tasks", {"run_id": run_id}).execute()
        if hasattr(result, 'error') and result.error:
            raise RuntimeError(f"Failed to increment completed tasks: {result.error}")

    def increment_failed_tasks(self, run_id: str) -> None:
        """
        Atomically increment failed_tasks counter.

        Args:
            run_id: UUID of the survey run

        Raises:
            RuntimeError: If the RPC call fails.
        """
        result = self.client.rpc("increment_failed_tasks", {"run_id": run_id}).execute()
        if hasattr(result, 'error') and result.error:
            raise RuntimeError(f"Failed to increment failed tasks: {result.error}")

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
        rpc_result = self.client.rpc(
            "append_run_result",
            {"run_id": run_id, "backstory_uuid": backstory_id, "task_result": result},
        ).execute()
        if hasattr(rpc_result, 'error') and rpc_result.error:
            raise RuntimeError(f"Failed to append run result: {rpc_result.error}")

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
        rpc_result = self.client.rpc(
            "append_run_error",
            {"run_id": run_id, "backstory_uuid": backstory_id, "error_msg": error},
        ).execute()
        if hasattr(rpc_result, 'error') and rpc_result.error:
            raise RuntimeError(f"Failed to append run error: {rpc_result.error}")

    def check_run_completion(self, run_id: str) -> None:
        """
        Check if run is complete and update status accordingly.

        Args:
            run_id: UUID of the survey run

        Raises:
            RuntimeError: If the RPC call fails.
        """
        result = self.client.rpc("check_run_completion", {"run_id": run_id}).execute()
        if hasattr(result, 'error') and result.error:
            raise RuntimeError(f"Failed to check run completion: {result.error}")

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

        Demographics are stored as:
          {"c_age": {"value": "45-54", "distribution": {...}}, ...}

        Filters match on the "value" field within each dimension.
        Filter format: {"c_age": ["45-54", "55-64"], "c_gender": ["Male"]}

        Args:
            survey_id: UUID of the survey (to get demographic filter)
            demographic_filter: Optional demographic filter to apply

        Returns:
            List of backstory UUIDs
        """
        # TODO: Remove .neq("anthology") once anthology backstories have demographics
        query = self.client.table("backstories").select("id").eq("is_public", True).neq("source_type", "anthology")

        if demographic_filter:
            for key, allowed_values in demographic_filter.items():
                if not allowed_values or not isinstance(allowed_values, list):
                    continue
                # Filter: demographics->{key}->>'value' must be in allowed_values
                # Supabase PostgREST supports filtering into JSONB with ->
                # We use .in_ on the extracted text value
                for value in allowed_values:
                    # Use contains filter: demographics must contain {key: {value: val}}
                    # PostgREST @> operator via .contains()
                    pass
                # For multiple allowed values, we need an OR across them.
                # Supabase .contains() does AND, so for OR we fetch all and filter.
                # Alternative: use RPC or fetch all and filter in Python.
                # For now, fetch all and filter client-side for correctness.
                pass

        # Fetch all public backstories and filter client-side if needed
        if demographic_filter and any(
            v for v in demographic_filter.values() if v and isinstance(v, list)
        ):
            result = (
                self.client.table("backstories")
                .select("id, demographics")
                .eq("is_public", True)
                # TODO: Remove .neq("anthology") once anthology backstories have demographics
                .neq("source_type", "anthology")
                .execute()
            )
            filtered = []
            for row in result.data or []:
                demos = row.get("demographics") or {}
                match = True
                for key, allowed_values in demographic_filter.items():
                    if not allowed_values or not isinstance(allowed_values, list):
                        continue
                    dim = demos.get(key)
                    if not dim or dim.get("value") not in allowed_values:
                        match = False
                        break
                if match:
                    filtered.append(row["id"])
            return filtered

        result = query.execute()
        return [row["id"] for row in (result.data or [])]

    # ==================== Dispatcher Operations ====================

    def get_runs_needing_dispatch(self) -> List[Dict[str, Any]]:
        """
        Get survey runs that have pending tasks needing dispatch.

        Returns runs that are:
        - status = 'pending' (just created, not started)
        - status = 'running' (may have stale/lost tasks to re-dispatch)

        Returns:
            List of survey run records
        """
        # Get runs with status 'pending' or 'running'
        result = (
            self.client.table("survey_runs")
            .select("*")
            .in_("status", ["pending", "running"])
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

    def get_stale_queued_tasks(self, run_id: str, stale_minutes: int = 5) -> List[Dict[str, Any]]:
        """
        Get queued tasks that have been stuck for too long.

        These are tasks that were dispatched to RabbitMQ but never processed
        (likely lost due to worker crash or RabbitMQ issue).

        Args:
            run_id: UUID of the survey run
            stale_minutes: Minutes after which a queued task is considered stale

        Returns:
            List of stale queued task records
        """
        from datetime import datetime, timedelta, timezone

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
        cutoff_str = cutoff.isoformat()

        # Look for "queued" tasks that were dispatched but never picked up
        # We use queued_at (set when dispatching) to check staleness
        result = (
            self.client.table("survey_tasks")
            .select("id, backstory_id, queued_at")
            .eq("survey_run_id", run_id)
            .eq("status", "queued")
            .lt("queued_at", cutoff_str)
            .execute()
        )
        return result.data or []

    def mark_task_queued(self, task_id: str) -> None:
        """
        Mark a task as queued (dispatched to RabbitMQ).

        Args:
            task_id: UUID of the task
        """
        self.client.table("survey_tasks").update({
            "status": "queued",
            "queued_at": "now()"
        }).eq("id", task_id).execute()

    # ==================== User Config Operations ====================

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a user by ID.

        Args:
            user_id: UUID of the user

        Returns:
            User record or None if not found
        """
        return self._safe_single_execute(
            self.client.table("users")
            .select("*")
            .eq("id", user_id)
        )

    def get_user_llm_config(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a user's LLM configuration.

        Args:
            user_id: UUID of the user

        Returns:
            LLM config dict or None if not found
        """
        user = self.get_user(user_id)
        if not user:
            return None
        return user.get("llm_config")

    def get_user_api_key(self, user_id: str, key_type: str) -> Optional[str]:
        """
        Fetch a user's decrypted API key from Vault.

        This uses the get_user_api_key RPC function which requires
        service role access.

        Args:
            user_id: UUID of the user
            key_type: Type of key ('openrouter' or 'vllm')

        Returns:
            Decrypted API key or None if not found
        """
        result = self.client.rpc(
            "get_user_api_key",
            {"p_user_id": user_id, "p_key_type": key_type}
        ).execute()

        return result.data if result.data else None

    def get_survey_run_user_id(self, run_id: str) -> Optional[str]:
        """
        Get the user_id for a survey run.

        Args:
            run_id: UUID of the survey run

        Returns:
            User ID or None if not found
        """
        # Get the survey run, then get the survey, then get the user_id
        data = self._safe_single_execute(
            self.client.table("survey_runs")
            .select("surveys(user_id)")
            .eq("id", run_id)
        )

        if not data:
            return None

        surveys_data = data.get("surveys")
        if not surveys_data:
            return None

        return surveys_data.get("user_id")
