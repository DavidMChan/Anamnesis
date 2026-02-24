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

    def start_task(self, task_id: str) -> int:
        """
        Set task to processing and increment attempts atomically.

        Returns the new attempt count so the caller can check max_retries
        without a separate fetch.

        Args:
            task_id: UUID of the task

        Returns:
            New attempt count (0 if task not found).
        """
        result = self.client.rpc(
            "start_task",
            {"p_task_id": task_id}
        ).execute()
        return result.data if result.data else 0

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

    def get_run_status(self, run_id: str) -> Optional[str]:
        """
        Get the current status of a survey run.

        Args:
            run_id: UUID of the survey run

        Returns:
            Status string or None if not found
        """
        data = self._safe_single_execute(
            self.client.table("survey_runs").select("status").eq("id", run_id)
        )
        return data.get("status") if data else None

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

        Supports two formats:
        1. New DemographicSelectionConfig: {"mode": "top_k"|"balanced", "sample_size": N, "filters": {...}}
        2. Legacy DemographicFilter: {"c_age": ["45-54", "55-64"], ...}

        Args:
            survey_id: UUID of the survey (to get demographic filter)
            demographic_filter: Optional demographic filter/config to apply

        Returns:
            List of backstory UUIDs
        """
        from .scoring import select_backstory_ids as scoring_select

        # Fetch all public backstories with demographics
        # TODO: Remove .neq("anthology") once anthology backstories have demographics
        result = (
            self.client.table("backstories")
            .select("id, demographics")
            .eq("is_public", True)
            .neq("source_type", "anthology")
            .execute()
        )
        backstories = [
            row for row in (result.data or [])
            if row.get("demographics")
        ]

        if not demographic_filter:
            return [b["id"] for b in backstories]

        # New format: DemographicSelectionConfig
        if "mode" in demographic_filter and "filters" in demographic_filter:
            return scoring_select(demographic_filter, backstories)

        # Legacy format: value-based matching
        filtered = []
        for row in backstories:
            demos = row.get("demographics") or {}
            match = True
            for key, allowed_values in demographic_filter.items():
                if key == "_sample_size":
                    continue
                if not allowed_values or not isinstance(allowed_values, list):
                    continue
                dim = demos.get(key)
                if not dim or dim.get("value") not in allowed_values:
                    match = False
                    break
            if match:
                filtered.append(row["id"])

        # Apply legacy sample size limit
        sample_size_arr = demographic_filter.get("_sample_size")
        if isinstance(sample_size_arr, list) and len(sample_size_arr) > 0:
            limit = int(sample_size_arr[0])
            if limit > 0:
                filtered = filtered[:limit]

        return filtered

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

    def get_in_flight_count(self, run_id: str) -> int:
        """
        Count tasks that are currently queued or processing for a run.

        Args:
            run_id: UUID of the survey run

        Returns:
            Number of in-flight tasks
        """
        result = (
            self.client.table("survey_tasks")
            .select("id", count="exact")
            .eq("survey_run_id", run_id)
            .in_("status", ["queued", "processing"])
            .execute()
        )
        return result.count or 0

    def get_pending_tasks_for_dispatch(self, run_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Get pending tasks for a run (for dispatching to queue).

        Args:
            run_id: UUID of the survey run
            limit: Maximum number of tasks to return. None returns all.

        Returns:
            List of pending task records
        """
        query = (
            self.client.table("survey_tasks")
            .select("id, backstory_id")
            .eq("survey_run_id", run_id)
            .eq("status", "pending")
        )
        if limit:
            query = query.limit(limit)
        return query.execute().data or []

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

    # ==================== Demographic Survey Operations ====================

    def get_survey_type(self, run_id: str) -> Optional[str]:
        """
        Get the survey type for a run (via join to surveys table).

        Returns 'survey' or 'demographic', or None if not found.
        """
        data = self._safe_single_execute(
            self.client.table("survey_runs")
            .select("surveys(type)")
            .eq("id", run_id)
        )
        if not data:
            return None
        surveys_data = data.get("surveys")
        return surveys_data.get("type") if surveys_data else None

    def get_demographic_key_for_survey(self, run_id: str) -> Optional[Dict[str, Any]]:
        """
        Get the demographic key slug for a demographic survey run.

        The key slug is on surveys.demographic_key.
        distribution_mode and num_trials are in the run's llm_config snapshot.

        Returns {key, distribution_mode, num_trials} or None if not a demographic survey.
        """
        data = self._safe_single_execute(
            self.client.table("survey_runs")
            .select("llm_config, surveys(type, demographic_key)")
            .eq("id", run_id)
        )
        if not data:
            return None

        surveys_data = data.get("surveys")
        if not surveys_data or surveys_data.get("type") != "demographic":
            return None

        demo_key = surveys_data.get("demographic_key")
        if not demo_key:
            return None

        llm_config = data.get("llm_config") or {}
        return {
            "key": demo_key,
            "distribution_mode": llm_config.get("distribution_mode", "n_sample"),
            "num_trials": llm_config.get("num_trials", 20),
        }

    def write_demographic_result(
        self,
        backstory_id: str,
        demographic_key: str,
        value: str,
        distribution: Dict[str, Any],
    ) -> None:
        """
        Write demographic distribution result back to a backstory.

        Calls the write_demographic_result RPC function.
        """
        self.client.rpc(
            "write_demographic_result",
            {
                "p_backstory_id": backstory_id,
                "p_demographic_key": demographic_key,
                "p_value": value,
                "p_distribution": distribution,
            }
        ).execute()

    def finish_demographic_key(self, survey_id: str, status: str = "finished") -> None:
        """
        Update demographic_keys status when a demographic survey run finishes.

        The RPC looks up the key via surveys.demographic_key.
        """
        self.client.rpc(
            "finish_demographic_key",
            {
                "p_survey_id": survey_id,
                "p_status": status,
            }
        ).execute()

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

    def get_run_llm_context(self, run_id: str) -> Optional[Dict[str, Any]]:
        """
        Get llm_config snapshot and owning user_id for a survey run.

        Returns {"llm_config": {...}, "user_id": "..."} or None.
        """
        data = self._safe_single_execute(
            self.client.table("survey_runs")
            .select("llm_config, surveys(user_id)")
            .eq("id", run_id)
        )

        if not data:
            return None

        surveys_data = data.get("surveys")
        return {
            "llm_config": data.get("llm_config"),
            "user_id": surveys_data.get("user_id") if surveys_data else None,
        }
