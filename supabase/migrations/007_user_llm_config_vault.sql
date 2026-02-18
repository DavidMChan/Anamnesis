-- User LLM Config with Multi-Key Vault Encryption Migration
-- This migration extends Vault functions to support multiple API key types per user
-- Key types: 'openrouter', 'vllm'

-- ==============================================================================
-- FUNCTION: store_user_api_key (with key type)
-- Stores or updates a user's API key of a specific type in the Vault
-- Returns true on success
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
BEGIN
    -- Validate inputs
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id cannot be null';
    END IF;

    IF p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RAISE EXCEPTION 'key_type must be ''openrouter'' or ''vllm''';
    END IF;

    -- Empty string means delete the key
    IF p_api_key IS NULL OR p_api_key = '' THEN
        RETURN delete_user_api_key(p_user_id, p_key_type);
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';

    -- Check if secret already exists
    SELECT id INTO v_existing_id
    FROM vault.secrets
    WHERE name = v_secret_name;

    IF v_existing_id IS NOT NULL THEN
        -- Update existing secret
        UPDATE vault.secrets
        SET secret = p_api_key,
            updated_at = NOW()
        WHERE id = v_existing_id;
    ELSE
        -- Create new secret
        INSERT INTO vault.secrets (secret, name, description)
        VALUES (p_api_key, v_secret_name, p_key_type || ' API key for user ' || p_user_id::TEXT);
    END IF;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Failed to store API key: %', SQLERRM;
        RETURN FALSE;
END;
$$;

-- ==============================================================================
-- FUNCTION: delete_user_api_key (with key type)
-- Deletes a user's API key of a specific type from the Vault
-- Returns true on success (or if key didn't exist)
-- ==============================================================================
CREATE OR REPLACE FUNCTION delete_user_api_key(p_user_id UUID, p_key_type TEXT)
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
        RAISE EXCEPTION 'key_type must be ''openrouter'' or ''vllm''';
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';

    DELETE FROM vault.secrets WHERE name = v_secret_name;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Failed to delete API key: %', SQLERRM;
        RETURN FALSE;
END;
$$;

-- ==============================================================================
-- FUNCTION: get_masked_api_key (with key type)
-- Returns a masked version of the API key for display (e.g., "sk-or...abc")
-- Returns NULL if user has no API key of that type stored
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_masked_api_key(p_user_id UUID, p_key_type TEXT)
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
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RETURN NULL;
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';

    -- Get decrypted secret
    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets
    WHERE name = v_secret_name;

    IF v_decrypted_key IS NULL THEN
        RETURN NULL;
    END IF;

    v_key_length := LENGTH(v_decrypted_key);

    -- Return masked format: first 5 chars + "..." + last 3 chars
    -- For very short keys (< 10 chars), just show "***"
    IF v_key_length < 10 THEN
        RETURN '***';
    END IF;

    RETURN SUBSTRING(v_decrypted_key, 1, 5) || '...' || SUBSTRING(v_decrypted_key, v_key_length - 2, 3);
END;
$$;

-- ==============================================================================
-- FUNCTION: get_user_api_key (with key type)
-- Returns the decrypted API key (for worker use only)
-- This function should only be called by service role
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_user_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret_name TEXT;
    v_decrypted_key TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RETURN NULL;
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';

    -- Get decrypted secret
    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets
    WHERE name = v_secret_name;

    RETURN v_decrypted_key;
END;
$$;

-- ==============================================================================
-- FUNCTION: has_api_key (with key type)
-- Check if a user has an API key of a specific type stored (without revealing the key)
-- ==============================================================================
CREATE OR REPLACE FUNCTION has_api_key(p_user_id UUID, p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret_name TEXT;
    v_exists BOOLEAN;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_key_type IS NULL OR p_key_type NOT IN ('openrouter', 'vllm') THEN
        RETURN FALSE;
    END IF;

    v_secret_name := 'user_' || p_user_id::TEXT || '_' || p_key_type || '_key';

    SELECT EXISTS(
        SELECT 1 FROM vault.secrets WHERE name = v_secret_name
    ) INTO v_exists;

    RETURN v_exists;
END;
$$;

-- ==============================================================================
-- WRAPPER FUNCTIONS FOR USER-ONLY ACCESS
-- These use auth.uid() to ensure users can only access their own keys
-- ==============================================================================

-- Store API key (multi-key version)
CREATE OR REPLACE FUNCTION store_my_api_key(p_key_type TEXT, p_api_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN store_user_api_key(auth.uid(), p_key_type, p_api_key);
END;
$$;

-- Delete API key (multi-key version)
CREATE OR REPLACE FUNCTION delete_my_api_key(p_key_type TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN delete_user_api_key(auth.uid(), p_key_type);
END;
$$;

-- Get masked API key (multi-key version)
CREATE OR REPLACE FUNCTION get_my_masked_api_key(p_key_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN get_masked_api_key(auth.uid(), p_key_type);
END;
$$;

-- Check if I have API key (multi-key version)
CREATE OR REPLACE FUNCTION do_i_have_api_key(p_key_type TEXT)
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
-- GRANT PERMISSIONS
-- ==============================================================================

-- Grant execute permission to authenticated users for user-scoped functions
GRANT EXECUTE ON FUNCTION store_user_api_key(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_user_api_key(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_masked_api_key(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION has_api_key(UUID, TEXT) TO authenticated;

-- Grant execute on the "my" versions to authenticated users
GRANT EXECUTE ON FUNCTION store_my_api_key(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_my_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_masked_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION do_i_have_api_key(TEXT) TO authenticated;

-- ==============================================================================
-- BACKWARDS COMPATIBILITY
-- Keep single-argument versions working by defaulting to 'openrouter'
-- ==============================================================================

-- Wrapper for old store_my_api_key(TEXT) -> store_my_api_key('openrouter', TEXT)
CREATE OR REPLACE FUNCTION store_my_api_key(p_api_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN store_user_api_key(auth.uid(), 'openrouter', p_api_key);
END;
$$;

-- Wrapper for old delete_my_api_key() -> delete_my_api_key('openrouter')
CREATE OR REPLACE FUNCTION delete_my_api_key()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN delete_user_api_key(auth.uid(), 'openrouter');
END;
$$;

-- Wrapper for old get_my_masked_api_key() -> get_my_masked_api_key('openrouter')
CREATE OR REPLACE FUNCTION get_my_masked_api_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN get_masked_api_key(auth.uid(), 'openrouter');
END;
$$;

-- Wrapper for old do_i_have_api_key() -> do_i_have_api_key('openrouter')
CREATE OR REPLACE FUNCTION do_i_have_api_key()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN has_api_key(auth.uid(), 'openrouter');
END;
$$;

-- Grant execute on backwards-compatible versions
GRANT EXECUTE ON FUNCTION store_my_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_my_api_key() TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_masked_api_key() TO authenticated;
GRANT EXECUTE ON FUNCTION do_i_have_api_key() TO authenticated;

-- ==============================================================================
-- MIGRATION NOTE: Old keys using 'user_api_key_{user_id}' naming
-- ==============================================================================
-- The old migration (004_vault_api_keys.sql) used naming: user_api_key_{user_id}
-- The new naming is: user_{user_id}_{key_type}_key
--
-- If you want to migrate existing keys, run manually:
--
-- UPDATE vault.secrets
-- SET name = REPLACE(name, 'user_api_key_', 'user_') || '_openrouter_key'
-- WHERE name LIKE 'user_api_key_%';
--
-- This is NOT done automatically to avoid data issues.
-- ==============================================================================
