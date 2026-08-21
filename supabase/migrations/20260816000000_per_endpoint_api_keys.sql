-- Per-endpoint API keys for self-hosted servers
--
-- Until now key_type was limited to 'openrouter' | 'vllm', so every named
-- endpoint in profiles.llm_config.endpoints shared one credential. Different
-- servers realistically carry different keys, so key_type is widened to accept
-- 'vllm:<endpoint_id>', where endpoint_id is the client-generated id of an
-- entry in the endpoint registry.
--
-- The 'vllm' key stays valid and keeps working as the shared fallback for any
-- endpoint that has no key of its own — nothing already stored has to move.
--
-- Secret naming is unchanged for the two legacy key types: the ':' is mapped to
-- '_', so 'vllm' still resolves to user_<uuid>_vllm_key and the new per-endpoint
-- keys land on user_<uuid>_vllm_<endpoint_id>_key.

-- ==============================================================================
-- HELPERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION is_valid_api_key_type(p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT p_key_type IS NOT NULL
       AND (
            p_key_type IN ('openrouter', 'vllm')
            -- per-endpoint key: 'vllm:' + the registry id (uuid or ep-xxxx slug)
            OR p_key_type ~ '^vllm:[A-Za-z0-9_-]{1,64}$'
       );
$$;

CREATE OR REPLACE FUNCTION api_key_secret_name(p_user_id UUID, p_key_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT 'user_' || p_user_id::TEXT || '_' || REPLACE(p_key_type, ':', '_') || '_key';
$$;

-- Helpers are internal plumbing: keep them off the PostgREST surface. The
-- SECURITY DEFINER functions below run as the owner, so they still resolve.
REVOKE ALL ON FUNCTION is_valid_api_key_type(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION api_key_secret_name(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ==============================================================================
-- ADMIN FUNCTIONS (service_role only — signatures unchanged, no new GRANTs)
-- ==============================================================================

CREATE OR REPLACE FUNCTION store_user_api_key(p_user_id UUID, p_key_type TEXT, p_api_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret_name TEXT;
    v_existing_id UUID;
    v_description TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id cannot be null';
    END IF;
    IF NOT is_valid_api_key_type(p_key_type) THEN
        RAISE EXCEPTION 'key_type must be openrouter, vllm, or vllm:<endpoint_id>';
    END IF;
    IF p_api_key IS NULL OR p_api_key = '' THEN
        RETURN delete_user_api_key(p_user_id, p_key_type);
    END IF;

    v_secret_name := api_key_secret_name(p_user_id, p_key_type);
    v_description := p_key_type || ' API key for user ' || p_user_id::TEXT;

    SELECT id INTO v_existing_id FROM vault.secrets WHERE name = v_secret_name;

    IF v_existing_id IS NOT NULL THEN
        PERFORM vault.update_secret(v_existing_id, p_api_key, v_secret_name, v_description);
    ELSE
        PERFORM vault.create_secret(p_api_key, v_secret_name, v_description);
    END IF;

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to store API key: %', SQLERRM;
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION delete_user_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id cannot be null';
    END IF;
    IF NOT is_valid_api_key_type(p_key_type) THEN
        RAISE EXCEPTION 'key_type must be openrouter, vllm, or vllm:<endpoint_id>';
    END IF;

    DELETE FROM vault.secrets WHERE name = api_key_secret_name(p_user_id, p_key_type);
    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to delete API key: %', SQLERRM;
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION get_masked_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_decrypted_key TEXT;
    v_key_length INTEGER;
BEGIN
    IF p_user_id IS NULL OR NOT is_valid_api_key_type(p_key_type) THEN
        RETURN NULL;
    END IF;

    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets WHERE name = api_key_secret_name(p_user_id, p_key_type);

    IF v_decrypted_key IS NULL THEN RETURN NULL; END IF;

    v_key_length := LENGTH(v_decrypted_key);
    IF v_key_length < 10 THEN RETURN '***'; END IF;

    RETURN SUBSTRING(v_decrypted_key, 1, 5) || '...' || SUBSTRING(v_decrypted_key, v_key_length - 2, 3);
END;
$$;

CREATE OR REPLACE FUNCTION get_user_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_decrypted_key TEXT;
BEGIN
    IF p_user_id IS NULL OR NOT is_valid_api_key_type(p_key_type) THEN
        RETURN NULL;
    END IF;

    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets WHERE name = api_key_secret_name(p_user_id, p_key_type);

    RETURN v_decrypted_key;
END;
$$;

CREATE OR REPLACE FUNCTION has_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    IF p_user_id IS NULL OR NOT is_valid_api_key_type(p_key_type) THEN
        RETURN FALSE;
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM vault.secrets WHERE name = api_key_secret_name(p_user_id, p_key_type)
    ) INTO v_exists;
    RETURN v_exists;
END;
$$;
