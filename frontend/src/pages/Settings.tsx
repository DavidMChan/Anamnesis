import { useState, useEffect } from 'react'
import { useAuthContext } from '@/contexts/AuthContext'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { User, Key, Check, X, Eye, EyeOff, Settings as SettingsIcon } from 'lucide-react'
import type { LLMConfig } from '@/types/database'
import type { ApiKeyType } from '@/hooks/useAuth'

interface ApiKeyFieldProps {
  label: string
  keyType: ApiKeyType
  maskedKey: string | null
  onStore: (key: string, type: ApiKeyType) => Promise<{ error: Error | null; success: boolean }>
  onClear: (type: ApiKeyType) => Promise<{ error: Error | null; success: boolean }>
  saving: boolean
  setSaving: (saving: boolean) => void
  setSaved: (saved: boolean) => void
  optional?: boolean
}

function ApiKeyField({
  label,
  keyType,
  maskedKey,
  onStore,
  onClear,
  saving,
  setSaving,
  setSaved,
  optional = false,
}: ApiKeyFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [showInput, setShowInput] = useState(false)

  const handleSave = async () => {
    if (!inputValue.trim()) return

    setSaving(true)
    const result = await onStore(inputValue.trim(), keyType)
    setSaving(false)

    if (result.success) {
      setInputValue('')
      setIsEditing(false)
      setShowInput(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    await onClear(keyType)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setInputValue('')
    setShowInput(false)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`api_key_${keyType}`}>
        {label}
        {optional && <span className="text-muted-foreground ml-1">(optional)</span>}
      </Label>
      {isEditing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id={`api_key_${keyType}`}
                type={showInput ? 'text' : 'password'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter API key..."
                className="pr-10"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') handleCancel()
                }}
              />
              <button
                type="button"
                onClick={() => setShowInput(!showInput)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showInput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button onClick={handleSave} disabled={saving || !inputValue.trim()}>
              Save
            </Button>
            <Button variant="ghost" size="icon" onClick={handleCancel} title="Cancel">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter your API key. It will be encrypted and stored securely.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              id={`api_key_${keyType}_display`}
              type="text"
              value={maskedKey || ''}
              disabled
              placeholder={optional ? 'No API key (optional)' : 'No API key configured'}
              className="bg-muted font-mono"
            />
            <Button variant="outline" onClick={() => setIsEditing(true)}>
              {maskedKey ? 'Change' : 'Add'}
            </Button>
            {maskedKey && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClear}
                disabled={saving}
                title="Remove API key"
                className="text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {maskedKey
              ? 'Your API key is encrypted and stored securely in Supabase Vault.'
              : optional
                ? 'API key is optional for this provider.'
                : 'Add your API key to run surveys with LLM inference.'}
          </p>
        </div>
      )}
    </div>
  )
}

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
              <Label htmlFor="provider">Provider</Label>
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
                  <SelectItem value="vllm">vLLM (Self-hosted)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {provider === 'openrouter'
                  ? 'OpenRouter provides access to many LLM providers through a single API.'
                  : 'vLLM is a self-hosted inference server for running open-source models.'}
              </p>
            </div>

            {/* OpenRouter Settings */}
            {provider === 'openrouter' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  OpenRouter Settings
                </div>

                <ApiKeyField
                  label="API Key"
                  keyType="openrouter"
                  maskedKey={maskedApiKeys.openrouter}
                  onStore={storeApiKey}
                  onClear={clearApiKey}
                  saving={saving}
                  setSaving={setSaving}
                  setSaved={setSaved}
                />

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

            {/* vLLM Settings */}
            {provider === 'vllm' && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <div className="h-2 w-2 rounded-full bg-purple-500" />
                  vLLM Settings
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vllm_endpoint">Endpoint</Label>
                  <Input
                    id="vllm_endpoint"
                    value={llmConfig.vllm_endpoint || ''}
                    onChange={(e) => setLlmConfig({ ...llmConfig, vllm_endpoint: e.target.value })}
                    placeholder="http://localhost:8000/v1"
                  />
                  <p className="text-xs text-muted-foreground">
                    The URL of your vLLM server (OpenAI-compatible API endpoint).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vllm_model">Model</Label>
                  <Input
                    id="vllm_model"
                    value={llmConfig.vllm_model || ''}
                    onChange={(e) => setLlmConfig({ ...llmConfig, vllm_model: e.target.value })}
                    placeholder="meta-llama/Llama-3-70b"
                  />
                  <p className="text-xs text-muted-foreground">
                    The model name as configured on your vLLM server.
                  </p>
                </div>

                <ApiKeyField
                  label="API Key"
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
            )}

            {/* Generation Settings */}
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <SettingsIcon className="h-4 w-4" />
                Generation Settings
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="temperature">Temperature</Label>
                  <Input
                    id="temperature"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={llmConfig.temperature ?? ''}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        temperature: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    placeholder="0.0"
                  />
                  <p className="text-xs text-muted-foreground">
                    Controls randomness. 0 = deterministic.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_tokens">Max Tokens</Label>
                  <Input
                    id="max_tokens"
                    type="number"
                    min="1"
                    max="16384"
                    step="1"
                    value={llmConfig.max_tokens ?? ''}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        max_tokens: e.target.value ? parseInt(e.target.value, 10) : undefined,
                      })
                    }
                    placeholder="64"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum tokens in response.
                  </p>
                </div>
              </div>
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
