import { describe, it, expect } from 'vitest'
import { maskApiKey, isValidApiKey } from '@/lib/apiKeyUtils'

describe('API Key Utilities', () => {
  describe('maskApiKey', () => {
    it('should mask a standard API key correctly', () => {
      const apiKey = 'sk-1234567890abcdef'
      const masked = maskApiKey(apiKey)
      expect(masked).toBe('sk-...def')
    })

    it('should mask a longer API key correctly', () => {
      const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456'
      const masked = maskApiKey(apiKey)
      expect(masked).toBe('sk-...456')
    })

    it('should return "***" for short keys (< 8 chars)', () => {
      const shortKey = 'abc123'
      const masked = maskApiKey(shortKey)
      expect(masked).toBe('***')
    })

    it('should return null for null input', () => {
      const masked = maskApiKey(null)
      expect(masked).toBeNull()
    })

    it('should return null for undefined input', () => {
      const masked = maskApiKey(undefined)
      expect(masked).toBeNull()
    })

    it('should return null for empty string', () => {
      const masked = maskApiKey('')
      expect(masked).toBeNull()
    })

    it('should handle exactly 8 character key', () => {
      const key = '12345678'
      const masked = maskApiKey(key)
      expect(masked).toBe('123...678')
    })
  })

  describe('isValidApiKey', () => {
    it('should return true for OpenAI-style keys', () => {
      expect(isValidApiKey('sk-1234567890abcdefghijklmnop')).toBe(true)
    })

    it('should return true for Anthropic-style keys', () => {
      expect(isValidApiKey('sk-ant-api03-abcdefghijklmnop')).toBe(true)
    })

    it('should return true for Together AI keys', () => {
      expect(isValidApiKey('abcdef1234567890abcdef1234567890')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(isValidApiKey('')).toBe(false)
    })

    it('should return false for null', () => {
      expect(isValidApiKey(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isValidApiKey(undefined)).toBe(false)
    })

    it('should return false for very short strings', () => {
      expect(isValidApiKey('abc')).toBe(false)
    })

    it('should return true for minimum valid length (8 chars)', () => {
      expect(isValidApiKey('12345678')).toBe(true)
    })
  })
})
