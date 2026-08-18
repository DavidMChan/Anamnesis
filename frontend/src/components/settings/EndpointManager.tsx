import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoHint } from '@/components/ui/info-hint'
import { ApiKeyField } from '@/components/settings/ApiKeyField'
import { Plus, Trash2, Server } from 'lucide-react'
import { useAuthContext } from '@/contexts/AuthContext'
import { endpointKeyType } from '@/hooks/useAuth'
import { getEndpoints, getActiveEndpoint, applyEndpoint } from '@/lib/llmConfig'
import type { LLMConfig, LLMEndpoint } from '@/types/database'

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `ep-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Manage the list of named self-hosted / OpenAI-compatible servers.
 *
 * The registry lives on the profile config; the selected entry is mirrored into
 * the flat `vllm_endpoint` / `vllm_model` fields on every change so anything
 * reading the legacy shape (run snapshots, validation) stays correct.
 *
 * API keys are the exception: they never touch `llm_config`. Each endpoint's
 * key lives in Vault under the key type `vllm:<endpoint_id>`, so — unlike the
 * rest of this form — adding or removing one takes effect immediately rather
 * than on Save. An endpoint with no key of its own falls back to the shared
 * `vllm` key, which is what every endpoint used before this existed.
 */
export function EndpointManager({
  config,
  onChange,
}: {
  config: LLMConfig
  onChange: (config: LLMConfig) => void
}) {
  const { maskedApiKeys, fetchMaskedApiKey, storeApiKey, clearApiKey } = useAuthContext()
  const endpoints = getEndpoints(config)
  const activeId = getActiveEndpoint(config)?.id

  // Masked per-endpoint keys, fetched one RPC per endpoint. Keyed by endpoint
  // id; a missing entry means "not loaded yet", null means "no key stored".
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string | null>>({})
  const endpointIds = endpoints.map((e) => e.id).join(',')

  const refreshKey = useCallback(
    async (id: string) => {
      const masked = await fetchMaskedApiKey(endpointKeyType(id))
      setMaskedKeys((prev) => ({ ...prev, [id]: masked }))
    },
    [fetchMaskedApiKey],
  )

  useEffect(() => {
    const ids = endpointIds ? endpointIds.split(',') : []
    if (!ids.length) return

    let cancelled = false
    Promise.all(
      ids.map(async (id) => [id, await fetchMaskedApiKey(endpointKeyType(id))] as const),
    ).then((entries) => {
      if (!cancelled) setMaskedKeys(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [endpointIds, fetchMaskedApiKey])

  /** Persist a new endpoint list, keeping the flattened active endpoint in sync. */
  const commit = (next: LLMEndpoint[], nextActiveId?: string) => {
    const wantedId = nextActiveId ?? activeId
    const active = next.find((e) => e.id === wantedId) ?? next[0]
    const base: LLMConfig = { ...config, endpoints: next }

    if (!active) {
      onChange({ ...base, active_endpoint_id: undefined, vllm_endpoint: '', vllm_model: '' })
      return
    }
    onChange(applyEndpoint(base, active))
  }

  const addEndpoint = () => {
    const endpoint: LLMEndpoint = {
      id: newId(),
      name: endpoints.length ? `Endpoint ${endpoints.length + 1}` : 'Default',
      endpoint: '',
      model: '',
      use_chat_template: false,
      use_guided_decoding: false,
    }
    commit([...endpoints, endpoint], endpoints.length ? activeId : endpoint.id)
  }

  const updateEndpoint = (id: string, patch: Partial<LLMEndpoint>) => {
    commit(endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const removeEndpoint = (id: string) => {
    const next = endpoints.filter((e) => e.id !== id)
    commit(next, id === activeId ? next[0]?.id : activeId)
    // Drop the credential with the server it belonged to — leaving it in Vault
    // would strand a secret under an id nothing can reach again.
    void clearApiKey(endpointKeyType(id))
    setMaskedKeys((prev) => {
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <div className="h-2 w-2 rounded-full bg-purple-500" />
          Endpoints
          <InfoHint>
            <span className="block font-medium">Any OpenAI-compatible server</span>
            <span className="block">
              Requests are made with the OpenAI SDK pointed at your base URL, so vLLM,
              SGLang, TGI, llama.cpp, Ollama or your own FastAPI wrapper all work — the
              server just has to speak the OpenAI HTTP shape.
            </span>
            <span className="block">
              Save as many as you like and pick which one a run uses here or per survey.
              Each one can carry its own API key; endpoints without one fall back to the
              shared self-hosted key above.
            </span>
          </InfoHint>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addEndpoint}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add endpoint
        </Button>
      </div>

      {endpoints.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No endpoints yet. Add one to point Anamnesis at your own inference server.
        </p>
      )}

      {endpoints.map((ep) => {
        const isActive = ep.id === activeId
        return (
          <div
            key={ep.id}
            className={`space-y-3 rounded-md border p-3 ${isActive ? 'border-purple-500/60 bg-purple-500/5' : ''}`}
          >
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                value={ep.name}
                onChange={(e) => updateEndpoint(ep.id, { name: e.target.value })}
                placeholder="Music Flamingo (islay)"
                className="h-8"
              />
              {isActive ? (
                <Badge variant="secondary" className="shrink-0">
                  Default
                </Badge>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => commit(endpoints, ep.id)}
                >
                  Set default
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeEndpoint(ep.id)}
                aria-label={`Remove ${ep.name || 'endpoint'}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`endpoint-${ep.id}`} className="flex items-center gap-1.5">
                Base URL
                <InfoHint>
                  <span className="block">
                    The <span className="font-mono">/v1</span> base of your server — for example{' '}
                    <span className="font-mono">http://islay.cs.berkeley.edu:8000/v1</span>.
                  </span>
                  <span className="block">
                    Stop at <span className="font-mono">/v1</span>. Do not include{' '}
                    <span className="font-mono">/chat/completions</span>. If you omit{' '}
                    <span className="font-mono">/v1</span> the worker appends it for you.
                  </span>
                </InfoHint>
              </Label>
              <Input
                id={`endpoint-${ep.id}`}
                value={ep.endpoint}
                onChange={(e) => updateEndpoint(ep.id, { endpoint: e.target.value })}
                placeholder="http://localhost:8000/v1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`model-${ep.id}`} className="flex items-center gap-1.5">
                Model <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                <InfoHint>
                  <span className="block">
                    Sent as the <span className="font-mono">model</span> field on every request.
                    For vLLM this has to match the value of{' '}
                    <span className="font-mono">--served-model-name</span>.
                  </span>
                  <span className="block">
                    Leave it blank if your server only ever serves one model and doesn't check
                    this field.
                  </span>
                </InfoHint>
              </Label>
              <Input
                id={`model-${ep.id}`}
                value={ep.model}
                onChange={(e) => updateEndpoint(ep.id, { model: e.target.value })}
                placeholder="meta-llama/Llama-3-70b (optional)"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Chat template
                  <InfoHint>
                    <span className="block">
                      <span className="font-medium">On</span> (chat completions) → requests go to{' '}
                      <span className="font-mono">/v1/chat/completions</span> as messages, formatted
                      with the model's chat template.
                    </span>
                    <span className="block">
                      <span className="font-medium">Off</span> (text completions) → requests go to{' '}
                      <span className="font-mono">/v1/completions</span> as a raw prompt string, no
                      template applied.
                    </span>
                    <span className="block">
                      <span className="font-medium">Base model, text-only survey</span> → leave this
                      off. Most base checkpoints (no{' '}
                      <span className="font-mono">-Instruct</span> suffix) ship with no chat template
                      at all, and vLLM/transformers reject chat-completions requests outright when
                      one is missing.
                    </span>
                    <span className="block">
                      <span className="font-medium">Any question with image or audio media</span>{' '}
                      always uses <span className="font-mono">/v1/chat/completions</span> regardless
                      of this setting, since media is sent as structured content parts — a survey
                      with media questions needs a model that both supports multimodal input and
                      ships a chat template, or those questions will fail no matter how this is set.
                    </span>
                  </InfoHint>
                </Label>
                <Select
                  value={ep.use_chat_template === false ? 'false' : 'true'}
                  onValueChange={(v) => updateEndpoint(ep.id, { use_chat_template: v === 'true' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Chat completions</SelectItem>
                    <SelectItem value="false">Text completions</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Guided decoding
                  <InfoHint>
                    <span className="block">
                      Constrains multiple-choice answers to valid options using vLLM's{' '}
                      <span className="font-mono">structured_outputs</span> parameter, and caps MCQ
                      responses at a single token.
                    </span>
                    <span className="block font-medium">
                      This is a vLLM extension, not part of the OpenAI API.
                    </span>
                    <span className="block">
                      Turn it off for any server that is not vLLM. If the server rejects the
                      parameter the task fails outright — unlike OpenRouter, self-hosted endpoints
                      do not fall back to plain text mode.
                    </span>
                  </InfoHint>
                </Label>
                <Select
                  value={ep.use_guided_decoding === false ? 'false' : 'true'}
                  onValueChange={(v) => updateEndpoint(ep.id, { use_guided_decoding: v === 'true' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Enabled (vLLM)</SelectItem>
                    <SelectItem value="false">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ApiKeyField
              label={
                <span className="flex items-center gap-1.5">
                  API key
                  <InfoHint>
                    <span className="block">
                      Sent as <span className="font-mono">Authorization: Bearer …</span> to this
                      server only. Stored encrypted in Supabase Vault, never in your profile
                      config or in a run snapshot.
                    </span>
                    <span className="block">
                      Unlike the rest of this form, the key is saved the moment you press Save
                      here — it does not wait for Save Changes at the bottom of the page.
                    </span>
                  </InfoHint>
                </span>
              }
              keyType={endpointKeyType(ep.id)}
              maskedKey={maskedKeys[ep.id] ?? null}
              onStore={storeApiKey}
              onClear={clearApiKey}
              optional
              onChanged={() => refreshKey(ep.id)}
              hint={
                maskedKeys[ep.id]
                  ? 'Used for this endpoint only.'
                  : maskedApiKeys.vllm
                    ? `No key of its own — falls back to the shared self-hosted key (${maskedApiKeys.vllm}).`
                    : 'No key. Requests go out unauthenticated unless you set the shared self-hosted key.'
              }
            />
          </div>
        )
      })}
    </div>
  )
}
