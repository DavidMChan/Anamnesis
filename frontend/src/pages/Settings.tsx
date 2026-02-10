import { useState, useEffect } from 'react'
import { useAuthContext } from '@/contexts/AuthContext'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { User, Key, Check } from 'lucide-react'
import type { LLMConfig } from '@/types/database'

export function Settings() {
  const { profile, updateProfile } = useAuthContext()
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

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)

    await updateProfile({
      name,
      llm_config: llmConfig,
    })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

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
                <CardDescription>
                  Configure your LLM provider for running surveys
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={llmConfig.provider || ''}
                onValueChange={(value) =>
                  setLlmConfig({ ...llmConfig, provider: value as LLMConfig['provider'] })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="together">Together AI</SelectItem>
                  <SelectItem value="vllm">vLLM (Self-hosted)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api_key">API Key</Label>
              <Input
                id="api_key"
                type="password"
                value={llmConfig.api_key || ''}
                onChange={(e) => setLlmConfig({ ...llmConfig, api_key: e.target.value })}
                placeholder="sk-..."
              />
              <p className="text-xs text-muted-foreground">
                Your API key is encrypted and stored securely
              </p>
            </div>

            {llmConfig.provider === 'vllm' && (
              <div className="space-y-2">
                <Label htmlFor="vllm_endpoint">vLLM Endpoint</Label>
                <Input
                  id="vllm_endpoint"
                  value={llmConfig.vllm_endpoint || ''}
                  onChange={(e) => setLlmConfig({ ...llmConfig, vllm_endpoint: e.target.value })}
                  placeholder="http://localhost:8000"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={llmConfig.model || ''}
                onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
                placeholder="gpt-4, claude-3-opus, etc."
              />
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex items-center gap-4">
          <Button onClick={handleSave} loading={saving}>
            Save Changes
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
