import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, Eye, EyeOff } from 'lucide-react'
import type { ApiKeyType } from '@/hooks/useAuth'

export interface ApiKeyFieldProps {
  label: ReactNode
  keyType: ApiKeyType
  maskedKey: string | null
  onStore: (key: string, type: ApiKeyType) => Promise<{ error: Error | null; success: boolean }>
  onClear: (type: ApiKeyType) => Promise<{ error: Error | null; success: boolean }>
  /** Page-level busy state. Omit to let the field track its own. */
  saving?: boolean
  setSaving?: (saving: boolean) => void
  setSaved?: (saved: boolean) => void
  optional?: boolean
  /** Replaces the default helper line under the field. */
  hint?: ReactNode
  /** Called after a successful store/clear — used to refetch the mask. */
  onChanged?: () => void
}

/**
 * Add / replace / remove one Vault-stored API key.
 *
 * The plaintext key never round-trips: what comes back from the server is the
 * masked form, so the field only ever shows `sk-ab...xyz` and edits are
 * write-only.
 */
export function ApiKeyField({
  label,
  keyType,
  maskedKey,
  onStore,
  onClear,
  saving,
  setSaving,
  setSaved,
  optional = false,
  hint,
  onChanged,
}: ApiKeyFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [localSaving, setLocalSaving] = useState(false)

  // A caller may pass a shared busy flag to coordinate multiple key fields;
  // standalone uses fall back to local state.
  const busy = saving ?? localSaving
  const markSaving = (v: boolean) => (setSaving ? setSaving(v) : setLocalSaving(v))
  const markSaved = () => {
    if (!setSaved) return
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // ':' is legal in an HTML id but awkward in selectors — per-endpoint key
  // types are `vllm:<endpoint_id>`, so flatten it.
  const fieldId = `api_key_${keyType.replace(':', '-')}`

  const handleSave = async () => {
    if (!inputValue.trim()) return

    markSaving(true)
    const result = await onStore(inputValue.trim(), keyType)
    markSaving(false)

    if (result.success) {
      setInputValue('')
      setIsEditing(false)
      setShowInput(false)
      markSaved()
      onChanged?.()
    }
  }

  const handleClear = async () => {
    markSaving(true)
    await onClear(keyType)
    markSaving(false)
    markSaved()
    onChanged?.()
  }

  const handleCancel = () => {
    setIsEditing(false)
    setInputValue('')
    setShowInput(false)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>
        {label}
        {optional && <span className="text-muted-foreground ml-1">(optional)</span>}
      </Label>
      {isEditing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id={fieldId}
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
            <Button onClick={handleSave} disabled={busy || !inputValue.trim()}>
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
              id={`${fieldId}_display`}
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
                disabled={busy}
                title="Remove API key"
                className="text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {hint ??
              (maskedKey
                ? 'Your API key is encrypted and stored securely in Supabase Vault.'
                : optional
                  ? 'API key is optional for this provider.'
                  : 'Add your API key to run surveys with LLM inference.')}
          </div>
        </div>
      )}
    </div>
  )
}
