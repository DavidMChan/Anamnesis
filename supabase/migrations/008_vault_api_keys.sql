-- Vault API Key Encryption for User LLM Config
-- Stores API keys encrypted in Supabase Vault, keyed by (user_id, key_type)
-- Key types: 'openrouter', 'vllm'
--
-- SECURITY MODEL:
--   - Admin functions (store_user_api_key, get_user_api_key, etc.) are NOT
--     granted to any role. Only service_role can call them directly.
--   - User-facing functions (store_my_api_key, get_my_masked_api_key, etc.)
--     use auth.uid() and are granted to authenticated users.
--   - No function overloads — each name has exactly ONE signature to avoid
--     PostgREST disambiguation issues.

-- ==============================================================================
-- CLEANUP: Drop old overloads from previous migrations (004, 007)
-- These cause PostgREST ambiguity and must be removed.
-- ==============================================================================
DROP FUNCTION IF EXISTS store_user_api_key(UUID, TEXT);
DROP FUNCTION IF EXISTS delete_user_api_key(UUID);
DROP FUNCTION IF EXISTS get_masked_api_key(UUID);
DROP FUNCTION IF EXISTS get_user_api_key(UUID);
DROP FUNCTION IF EXISTS has_api_key(UUID);
DROP FUNCTION IF EXISTS store_my_api_key(TEXT);
DROP FUNCTION IF EXISTS delete_my_api_key();
DROP FUNCTION IF EXISTS get_my_masked_api_key();
DROP FUNCTION IF EXISTS do_i_have_api_key();

-- Also drop the current signatures in case re-running this migration
DROP FUNCTION IF EXISTS store_user_api_key(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS delete_user_api_key(UUID, TEXT);
DROP FUNCTION IF EXISTS get_masked_api_key(UUID, TEXT);
DROP FUNCTION IF EXISTS get_user_api_key(UUID, TEXT);
DROP FUNCTION IF EXISTS has_api_key(UUID, TEXT);
DROP FUNCTION IF EXISTS store_my_api_key(TEXT, TEXT);
DROP FUNCTION IF EXISTS delete_my_api_key(TEXT);
DROP FUNCTION IF EXISTS get_my_masked_api_key(TEXT);
DROP FUNCTION IF EXISTS do_i_have_api_key(TEXT);

-- ==============================================================================
-- ADMIN FUNCTIONS (service_role only — NO GRANT to authenticated/anon)
-- ==============================================================================

CREATE FUNCTION store_user_api_key(p_user_id UUID, p_key_type TEXT, p_api_key TEXT)
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
    IF p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RAISE EXCEPTION 'key_type must be openrouter or vllm';
    END IF;
    IF p_api_key IS NULL OR p_api_key = '' THEN
        RETURN delete_user_api_key(p_user_id, p_key_type);
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';
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

CREATE FUNCTION delete_user_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret_name TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id cannot be null';
    END IF;
    IF p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RAISE EXCEPTION 'key_type must be openrouter or vllm';
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';
    DELETE FROM vault.secrets WHERE name = v_secret_name;
    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to delete API key: %', SQLERRM;
    RETURN FALSE;
END;
$$;

CREATE FUNCTION get_masked_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret_name TEXT;
    v_decrypted_key TEXT;
    v_key_length INTEGER;
BEGIN
    IF p_user_id IS NULL OR p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RETURN NULL;
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';

    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets WHERE name = v_secret_name;

    IF v_decrypted_key IS NULL THEN RETURN NULL; END IF;

    v_key_length := LENGTH(v_decrypted_key);
    IF v_key_length < 10 THEN RETURN '***'; END IF;

    RETURN SUBSTRING(v_decrypted_key, 1, 5) || '...' || SUBSTRING(v_decrypted_key, v_key_length - 2, 3);
END;
$$;

CREATE FUNCTION get_user_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret_name TEXT;
    v_decrypted_key TEXT;
BEGIN
    IF p_user_id IS NULL OR p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RETURN NULL;
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';

    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets WHERE name = v_secret_name;

    RETURN v_decrypted_key;
END;
$$;

CREATE FUNCTION has_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret_name TEXT;
    v_exists BOOLEAN;
BEGIN
    IF p_user_id IS NULL OR p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RETURN FALSE;
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';
    SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE name = v_secret_name) INTO v_exists;
    RETURN v_exists;
END;
$$;

-- ==============================================================================
-- USER-FACING FUNCTIONS (use auth.uid(), granted to authenticated)
-- Each name has exactly ONE signature — no overloads.
-- ==============================================================================

CREATE FUNCTION store_my_api_key(p_key_type TEXT, p_api_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN store_user_api_key(auth.uid(), p_key_type, p_api_key);
END;
$$;

CREATE FUNCTION delete_my_api_key(p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN delete_user_api_key(auth.uid(), p_key_type);
END;
$$;

CREATE FUNCTION get_my_masked_api_key(p_key_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN get_masked_api_key(auth.uid(), p_key_type);
END;
$$;

CREATE FUNCTION do_i_have_api_key(p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN has_api_key(auth.uid(), p_key_type);
END;
$$;

-- ==============================================================================
-- GRANTS: Only user-facing functions are callable by authenticated users.
-- Admin functions (store_user_api_key, get_user_api_key, etc.) have NO GRANT —
-- only service_role (worker) can call them.
-- ==============================================================================

GRANT EXECUTE ON FUNCTION store_my_api_key(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_my_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_masked_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION do_i_have_api_key(TEXT) TO authenticated;
