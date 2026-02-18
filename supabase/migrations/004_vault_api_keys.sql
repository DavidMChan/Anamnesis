-- Supabase Vault API Key Encryption Migration
-- This migration sets up secure storage for user API keys using Supabase Vault

-- Note: supabase_vault extension is automatically available in Supabase
-- If running locally, you may need to enable it first

-- ==============================================================================
-- FUNCTION: store_user_api_key
-- Stores or updates a user's API key in the Vault
-- Returns true on success
-- ==============================================================================
CREATE OR REPLACE FUNCTION store_user_api_key(p_user_id UUID, p_api_key TEXT)
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

    -- Empty string means delete the key
    IF p_api_key IS NULL OR p_api_key = '' THEN
        RETURN delete_user_api_key(p_user_id);
    END IF;

    v_secret_name := 'user_api_key_' || p_user_id::TEXT;

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
        VALUES (p_api_key, v_secret_name, 'LLM API key for user ' || p_user_id::TEXT);
    END IF;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Failed to store API key: %', SQLERRM;
        RETURN FALSE;
END;
$$;

-- ==============================================================================
-- FUNCTION: delete_user_api_key
-- Deletes a user's API key from the Vault
-- Returns true on success (or if key didn't exist)
-- ==============================================================================
CREATE OR REPLACE FUNCTION delete_user_api_key(p_user_id UUID)
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

    v_secret_name := 'user_api_key_' || p_user_id::TEXT;

    DELETE FROM vault.secrets WHERE name = v_secret_name;

    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Failed to delete API key: %', SQLERRM;
        RETURN FALSE;
END;
$$;

-- ==============================================================================
-- FUNCTION: get_masked_api_key
-- Returns a masked version of the API key for display (e.g., "sk-...abc")
-- Returns NULL if user has no API key stored
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_masked_api_key(p_user_id UUID)
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

    v_secret_name := 'user_api_key_' || p_user_id::TEXT;

    -- Get decrypted secret
    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets
    WHERE name = v_secret_name;

    IF v_decrypted_key IS NULL THEN
        RETURN NULL;
    END IF;

    v_key_length := LENGTH(v_decrypted_key);

    -- Return masked format: first 3 chars + "..." + last 3 chars
    -- For very short keys (< 8 chars), just show "***"
    IF v_key_length < 8 THEN
        RETURN '***';
    END IF;

    RETURN SUBSTRING(v_decrypted_key, 1, 3) || '...' || SUBSTRING(v_decrypted_key, v_key_length - 2, 3);
END;
$$;

-- ==============================================================================
-- FUNCTION: get_user_api_key
-- Returns the decrypted API key (for worker use only)
-- This function should only be called by service role
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_user_api_key(p_user_id UUID)
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

    v_secret_name := 'user_api_key_' || p_user_id::TEXT;

    -- Get decrypted secret
    SELECT decrypted_secret INTO v_decrypted_key
    FROM vault.decrypted_secrets
    WHERE name = v_secret_name;

    RETURN v_decrypted_key;
END;
$$;

-- ==============================================================================
-- FUNCTION: has_api_key
-- Check if a user has an API key stored (without revealing the key)
-- ==============================================================================
CREATE OR REPLACE FUNCTION has_api_key(p_user_id UUID)
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

    v_secret_name := 'user_api_key_' || p_user_id::TEXT;

    SELECT EXISTS(
        SELECT 1 FROM vault.secrets WHERE name = v_secret_name
    ) INTO v_exists;

    RETURN v_exists;
END;
$$;

-- ==============================================================================
-- RLS POLICIES FOR FUNCTION ACCESS
-- ==============================================================================

-- Grant execute permission to authenticated users for safe functions
GRANT EXECUTE ON FUNCTION store_user_api_key(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_user_api_key(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_masked_api_key(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION has_api_key(UUID) TO authenticated;

-- get_user_api_key is only for service role (default, no grant needed for anon/authenticated)
-- Service role can access it directly

-- ==============================================================================
-- SECURITY NOTE
-- ==============================================================================
-- The functions are marked SECURITY DEFINER which means they run with the
-- privileges of the function owner (usually postgres), not the caller.
-- This is necessary to access vault.secrets and vault.decrypted_secrets.
--
-- However, we should add checks to ensure users can only access their own keys:
-- ==============================================================================

-- Create wrapper functions that enforce user-only access
CREATE OR REPLACE FUNCTION store_my_api_key(p_api_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- auth.uid() returns the current authenticated user's ID
    RETURN store_user_api_key(auth.uid(), p_api_key);
END;
$$;

CREATE OR REPLACE FUNCTION delete_my_api_key()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN delete_user_api_key(auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION get_my_masked_api_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN get_masked_api_key(auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION do_i_have_api_key()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN has_api_key(auth.uid());
END;
$$;

-- Grant execute on the "my" versions to authenticated users
GRANT EXECUTE ON FUNCTION store_my_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_my_api_key() TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_masked_api_key() TO authenticated;
GRANT EXECUTE ON FUNCTION do_i_have_api_key() TO authenticated;
