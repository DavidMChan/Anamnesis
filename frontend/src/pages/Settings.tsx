import { useState, useEffect } from 'react'
import { useAuthContext } from '@/contexts/AuthContext'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { InfoHint } from '@/components/ui/info-hint'
import { EndpointManager } from '@/components/settings/EndpointManager'
import { ApiKeyField } from '@/components/settings/ApiKeyField'
import { User, Key, Check } from 'lucide-react'
import type { LLMConfig } from '@/types/database'

export function Settings() {
  const { profile, updateProfile, maskedApiKeys, storeApiKey, clearApiKey } = useAuthContext()
  const [name, setName] = useState('')
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (profile) {
      setName(profile.name || '')
      setLlmConfig(profile.llm_config || {})
    }
  }, [profile])

  const handleSaveProfile = async () => {
    setSaving(true)
    setSaved(false)

    // Save profile settings (without api_key)
    await updateProfile({
      name,
      llm_config: llmConfig,
    })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const provider = llmConfig.provider || 'openrouter'

  return (
    <Layout>
      <div className="max-w-2xl space-y-8">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your account and LLM configuration</p>
        </div>

        {/* Profile Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Profile</CardTitle>
                <CardDescription>Your personal information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile?.email || ''} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Email cannot be changed</p>
            </div>
          </CardContent>
        </Card>

        {/* LLM Configuration Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Key className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">LLM Configuration</CardTitle>
                <CardDescription>Configure your LLM provider for running surveys</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label htmlFor="provider" className="flex items-center gap-1.5">
                Provider
                <InfoHint>
                  <span className="block">
                    <span className="font-medium">OpenRouter</span> — hosted models, billed per
                    token, no server of your own.
                  </span>
                  <span className="block">
                    <span className="font-medium">Self-hosted</span> — any server that speaks the
                    OpenAI HTTP API. Anamnesis just points the OpenAI SDK at your base URL, so it
                    is not limited to vLLM.
                  </span>
                </InfoHint>
              </Label>
              <Select
                value={provider}
                onValueChange={(value) =>
                  setLlmConfig({ ...llmConfig, provider: value as LLMConfig['provider'] })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="vllm">Self-hosted (OpenAI-compatible)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {provider === 'openrouter'
                  ? 'OpenRouter provides access to many LLM providers through a single API.'
                  : 'Any server exposing an OpenAI-compatible API — vLLM, SGLang, TGI, llama.cpp, Ollama, or your own wrapper around a custom model.'}
              </p>
            </div>

            {/* API Keys — always visible so both can be managed independently */}
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Key className="h-4 w-4" />
                API Keys
              </div>
              <p className="text-xs text-muted-foreground">
                Both keys are stored independently. The OpenRouter key is also used for the parser
                LLM fallback. The self-hosted key below is the fallback for endpoints that have no
                key of their own — set per-endpoint keys under Endpoints. Leave it empty if your
                servers do not check authorization.
              </p>

              <ApiKeyField
                label="OpenRouter API Key"
                keyType="openrouter"
                maskedKey={maskedApiKeys.openrouter}
                onStore={storeApiKey}
                onClear={clearApiKey}
                saving={saving}
                setSaving={setSaving}
                setSaved={setSaved}
              />

              <ApiKeyField
                label="Self-hosted API Key (shared fallback)"
                keyType="vllm"
                maskedKey={maskedApiKeys.vllm}
                onStore={storeApiKey}
                onClear={clearApiKey}
                saving={saving}
                setSaving={setSaving}
                setSaved={setSaved}
                optional
              />
            </div>

            {/* OpenRouter Model Settings */}
            {provider === 'openrouter' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  OpenRouter Model
                </div>

                <div className="space-y-2">
                  <Label htmlFor="openrouter_model">Model</Label>
                  <Input
                    id="openrouter_model"
                    value={llmConfig.openrouter_model || ''}
                    onChange={(e) => setLlmConfig({ ...llmConfig, openrouter_model: e.target.value })}
                    placeholder="anthropic/claude-3-haiku"
                  />
                  <p className="text-xs text-muted-foreground">
                    See{' '}
                    <a
                      href="https://openrouter.ai/models"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      OpenRouter models
                    </a>{' '}
                    for available options.
                  </p>
                </div>
              </div>
            )}

            {/* Self-hosted endpoints */}
            {provider === 'vllm' && (
              <EndpointManager config={llmConfig} onChange={setLlmConfig} />
            )}

            {/* Chat Template Toggle — self-hosted endpoints carry their own */}
            {provider === 'openrouter' && (
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <Checkbox
                id="use_chat_template"
                checked={llmConfig.use_chat_template === true}
                onCheckedChange={(checked) =>
                  setLlmConfig({ ...llmConfig, use_chat_template: checked === true })
                }
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="use_chat_template" className="cursor-pointer">
                  Use Chat Template
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable this if your model has a chat template (e.g., instruction-tuned models).
                  When unchecked, the worker uses the text completions API (/v1/completions),
                  which is better for base models without chat formatting.
                </p>
              </div>
            </div>
            )}

            {/* Parser LLM */}
            <div className="space-y-2">
              <Label htmlFor="parser_llm_model">Parser LLM Model</Label>
              <Input
                id="parser_llm_model"
                value={llmConfig.parser_llm_model || ''}
                onChange={(e) => setLlmConfig({ ...llmConfig, parser_llm_model: e.target.value })}
                placeholder="google/gemini-2.0-flash-001"
              />
              <p className="text-xs text-muted-foreground">
                Fallback model for parsing survey answers when guided decoding is not used or failed (via OpenRouter). Leave empty for default.
              </p>
            </div>

            {/* Max Concurrent Tasks */}
            <div className="space-y-2">
              <Label htmlFor="max_concurrent_tasks">Max Concurrent Tasks</Label>
              <Input
                id="max_concurrent_tasks"
                type="number"
                min={1}
                max={200}
                value={llmConfig.max_concurrent_tasks ?? 10}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setLlmConfig({ ...llmConfig, max_concurrent_tasks: Math.max(1, Math.min(200, val)) })
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Maximum parallel LLM requests per survey run. Start with 5-10 for cloud APIs
                (OpenAI, Anthropic). For self-hosted vLLM, try 20-100 — increase until you
                see rate-limit errors, then back off.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex items-center gap-4">
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          {saved && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" />
              <span>Changes saved!</span>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
