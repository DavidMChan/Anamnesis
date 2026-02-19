/**
 * API Key Utilities
 * Helper functions for handling API keys securely
 */

/**
 * Mask an API key for display (e.g., "sk-...def")
 * Shows first 3 characters + "..." + last 3 characters
 * Returns "***" for very short keys, null for empty/null input
 */
export function maskApiKey(apiKey: string | null | undefined): string | null {
  if (!apiKey || apiKey.length === 0) {
    return null
  }

  const keyLength = apiKey.length

  // For very short keys (< 8 chars), just show "***"
  if (keyLength < 8) {
    return '***'
  }

  // Return masked format: first 3 chars + "..." + last 3 chars
  return apiKey.substring(0, 3) + '...' + apiKey.substring(keyLength - 3)
}

/**
 * Validate that an API key has a reasonable format
 * This is a basic check - actual validation happens server-side
 */
export function isValidApiKey(apiKey: string | null | undefined): boolean {
  if (!apiKey || apiKey.length === 0) {
    return false
  }

  // Minimum length check (most API keys are at least 20+ chars)
  if (apiKey.length < 8) {
    return false
  }

  return true
}
