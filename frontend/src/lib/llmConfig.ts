import type { LLMConfig, LLMEndpoint } from '@/types/database'

export const LLM_DEFAULTS = {
  temperature: 1,
  max_tokens: 128,
} as const

/** Id used when migrating a pre-registry single-endpoint config. */
export const LEGACY_ENDPOINT_ID = 'legacy-default'

/** Extract display model name from an LLM config */
export function getModelName(config: Partial<LLMConfig> | undefined | null): string | undefined {
  if (!config) return undefined
  return config.provider === 'vllm' ? config.vllm_model : config.openrouter_model
}

/**
 * Read the endpoint registry, lazily migrating a legacy single-endpoint config.
 *
 * Older profiles only had flat `vllm_endpoint` / `vllm_model`. Rather than a SQL
 * migration, those are surfaced as one synthetic "Default" entry — writing the
 * registry back happens the first time the user saves Settings.
 */
export function getEndpoints(config: Partial<LLMConfig> | undefined | null): LLMEndpoint[] {
  if (!config) return []
  if (config.endpoints?.length) return config.endpoints
  if (config.vllm_endpoint || config.vllm_model) {
    return [
      {
        id: LEGACY_ENDPOINT_ID,
        name: 'Default',
        endpoint: config.vllm_endpoint || '',
        model: config.vllm_model || '',
        use_chat_template: config.use_chat_template,
        use_guided_decoding: config.use_guided_decoding,
      },
    ]
  }
  return []
}

/** The endpoint a config currently points at (falls back to the first one). */
export function getActiveEndpoint(
  config: Partial<LLMConfig> | undefined | null,
): LLMEndpoint | undefined {
  const endpoints = getEndpoints(config)
  if (!endpoints.length) return undefined
  return endpoints.find((e) => e.id === config?.active_endpoint_id) ?? endpoints[0]
}

/**
 * Flatten a named endpoint into the legacy fields the worker reads.
 *
 * `use_chat_template` / `use_guided_decoding` are only overwritten when the
 * endpoint defines them, so an endpoint that leaves them unset inherits the
 * profile-level values.
 */
export function applyEndpoint(config: LLMConfig, endpoint: LLMEndpoint): LLMConfig {
  const next: LLMConfig = {
    ...config,
    active_endpoint_id: endpoint.id,
    vllm_endpoint: endpoint.endpoint,
    vllm_model: endpoint.model,
  }
  if (endpoint.use_chat_template !== undefined) next.use_chat_template = endpoint.use_chat_template
  if (endpoint.use_guided_decoding !== undefined) {
    next.use_guided_decoding = endpoint.use_guided_decoding
  }
  return next
}

/**
 * Merge user profile defaults + local overrides + system defaults into a run config.
 *
 * Also resolves the selected named endpoint into the flat `vllm_*` fields and
 * drops the registry itself, so the `survey_runs.llm_config` snapshot stays the
 * shape `worker/src/config.py` expects.
 */
export function mergeEffectiveConfig(
  profileConfig: LLMConfig | undefined,
  overrides: Partial<LLMConfig> | null | undefined,
): LLMConfig {
  const merged = {
    ...profileConfig,
    ...overrides,
    temperature: overrides?.temperature ?? profileConfig?.temperature ?? LLM_DEFAULTS.temperature,
    max_tokens: overrides?.max_tokens ?? profileConfig?.max_tokens ?? LLM_DEFAULTS.max_tokens,
  } as LLMConfig

  // Resolve the named endpoint against the profile registry — an override only
  // carries `active_endpoint_id`, not the endpoint body.
  const registry = getEndpoints(profileConfig)
  const selected =
    registry.find((e) => e.id === merged.active_endpoint_id) ??
    (merged.vllm_endpoint ? undefined : registry[0])

  const resolved = selected ? applyEndpoint(merged, selected) : merged

  // The registry is profile state, not run state — keep it out of the snapshot.
  delete resolved.endpoints
  return resolved
}

/** Check which fields come from local override vs profile default */
export function getConfigSources(
  profileConfig: LLMConfig | undefined,
  overrides: Partial<LLMConfig> | null | undefined,
): Record<string, 'override' | 'profile' | 'default'> {
  const sources: Record<string, 'override' | 'profile' | 'default'> = {}

  for (const key of ['provider', 'openrouter_model', 'vllm_model', 'vllm_endpoint', 'active_endpoint_id', 'temperature', 'max_tokens', 'max_concurrent_tasks'] as const) {
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
