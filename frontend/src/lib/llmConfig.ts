import type { LLMConfig } from '@/types/database'

export const LLM_DEFAULTS = {
  temperature: 1,
  max_tokens: 128,
} as const

/** Extract display model name from an LLM config */
export function getModelName(config: Partial<LLMConfig> | undefined | null): string | undefined {
  if (!config) return undefined
  return config.provider === 'vllm' ? config.vllm_model : config.openrouter_model
}

/** Merge user profile defaults + local overrides + system defaults into a run config */
export function mergeEffectiveConfig(
  profileConfig: LLMConfig | undefined,
  overrides: Partial<LLMConfig> | null | undefined,
): LLMConfig {
  return {
    ...profileConfig,
    ...overrides,
    temperature: overrides?.temperature ?? profileConfig?.temperature ?? LLM_DEFAULTS.temperature,
    max_tokens: overrides?.max_tokens ?? profileConfig?.max_tokens ?? LLM_DEFAULTS.max_tokens,
  } as LLMConfig
}

/** Check which fields come from local override vs profile default */
export function getConfigSources(
  profileConfig: LLMConfig | undefined,
  overrides: Partial<LLMConfig> | null | undefined,
): Record<string, 'override' | 'profile' | 'default'> {
  const sources: Record<string, 'override' | 'profile' | 'default'> = {}

  for (const key of ['provider', 'openrouter_model', 'vllm_model', 'vllm_endpoint', 'temperature', 'max_tokens', 'max_concurrent_tasks'] as const) {
    if (overrides?.[key] != null) {
      sources[key] = 'override'
    } else if (profileConfig?.[key] != null) {
      sources[key] = 'profile'
    } else {
      sources[key] = 'default'
    }
  }

  return sources
}
