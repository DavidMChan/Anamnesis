import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { uploadMedia, getMediaUrl, isAcceptableMediaType, formatFileSize } from '@/lib/media'
import type { MediaAttachment } from '@/types/database'
import { Paperclip, X, FileAudio, Loader2 } from 'lucide-react'

interface MediaUploadProps {
  value?: MediaAttachment | null
  onChange: (media: MediaAttachment | null) => void
  /** Compact mode for per-option uploads (smaller button, inline preview) */
  compact?: boolean
}

export function MediaUpload({ value, onChange, compact = false }: MediaUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Load preview URL when value changes
  useEffect(() => {
    if (!value) {
      setPreviewUrl(null)
      return
    }

    let cancelled = false
    getMediaUrl(value.key)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url)
      })
      .catch(() => {
        // Silently fail preview — file may not be accessible yet
      })

    return () => { cancelled = true }
  }, [value?.key])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset input so the same file can be re-selected
    e.target.value = ''

    if (!isAcceptableMediaType(file)) {
      setError('Only images and audio files are accepted.')
      return
    }

    if (file.size > 25 * 1024 * 1024) {
      setError(`File too large (${formatFileSize(file.size)}). Max 25 MB.`)
      return
    }

    setError(null)
    setUploading(true)

    try {
      const attachment = await uploadMedia(file)
      onChange(attachment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = () => {
    onChange(null)
    setPreviewUrl(null)
    setError(null)
  }

  // Show upload button when no media attached
  if (!value) {
    return (
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Attach media"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          {!compact && <span className="ml-1">{uploading ? 'Uploading...' : 'Attach'}</span>}
        </Button>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    )
  }

  // Show preview when media is attached
  const isImage = value.type.startsWith('image/')

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {isImage && previewUrl ? (
          <img src={previewUrl} alt={value.name} className="h-8 w-8 rounded object-cover" />
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileAudio className="h-3 w-3" />
            <span className="max-w-20 truncate">{value.name}</span>
          </div>
        )}
        <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={handleRemove} title="Remove media">
          <X className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
      {isImage && previewUrl ? (
        <img src={previewUrl} alt={value.name} className="h-16 w-16 rounded object-cover" />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileAudio className="h-5 w-5" />
          <span className="max-w-48 truncate">{value.name}</span>
        </div>
      )}
      {isImage && (
        <span className="text-xs text-muted-foreground max-w-32 truncate">{value.name}</span>
      )}
      <Button type="button" variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={handleRemove} title="Remove media">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
