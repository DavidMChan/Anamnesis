import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoHint } from '@/components/ui/info-hint'
import { Plus, Trash2, Server } from 'lucide-react'
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
 */
export function EndpointManager({
  config,
  onChange,
}: {
  config: LLMConfig
  onChange: (config: LLMConfig) => void
}) {
  const endpoints = getEndpoints(config)
  const activeId = getActiveEndpoint(config)?.id

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
      use_chat_template: true,
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
              All of them share the single API key below.
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
                Model
                <InfoHint>
                  <span className="block">
                    Sent as the <span className="font-mono">model</span> field on every request.
                    It has to match whatever name your server answers to — for vLLM that is the
                    value of <span className="font-mono">--served-model-name</span>.
                  </span>
                </InfoHint>
              </Label>
              <Input
                id={`model-${ep.id}`}
                value={ep.model}
                onChange={(e) => updateEndpoint(ep.id, { model: e.target.value })}
                placeholder="meta-llama/Llama-3-70b"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Chat template
                  <InfoHint>
                    <span className="block">
                      <span className="font-medium">On</span> → requests go to{' '}
                      <span className="font-mono">/v1/chat/completions</span> as messages. Use this
                      for instruction-tuned and multimodal models.
                    </span>
                    <span className="block">
                      <span className="font-medium">Off</span> → requests go to{' '}
                      <span className="font-mono">/v1/completions</span> as a raw prompt string,
                      which is what you want for base models with no chat formatting.
                    </span>
                    <span className="block">
                      Questions carrying image or audio media always use{' '}
                      <span className="font-mono">/v1/chat/completions</span> regardless of this
                      setting, because media is sent as structured content parts.
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
          </div>
        )
      })}
    </div>
  )
}
