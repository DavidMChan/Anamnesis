import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { uploadMedia, getMediaUrl, isAcceptableMediaType, formatFileSize } from '@/lib/media'
import type { MediaAttachment } from '@/types/database'
import { Paperclip, X, FileAudio, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <button
        type="button"
        className="absolute top-4 right-4 text-white/80 hover:text-white"
        onClick={onClose}
      >
        <X className="h-6 w-6" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  )
}

interface MediaUploadProps {
  value?: MediaAttachment | null
  onChange: (media: MediaAttachment | null) => void
  /** Compact mode for per-option uploads (smaller button, inline preview) */
  compact?: boolean
  /** External control for audio expand (compact mode only). When provided, audio player is NOT rendered internally. */
  isAudioExpanded?: boolean
  onAudioToggle?: (expanded: boolean) => void
}

export function MediaUpload({ value, onChange, compact = false, isAudioExpanded, onAudioToggle }: MediaUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)

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

    if (file.size > 500 * 1024 * 1024) {
      setError(`File too large (${formatFileSize(file.size)}). Max 500 MB.`)
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
    setLightboxOpen(false)
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
    // Use external control if provided, else internal state
    const audioOpen = onAudioToggle ? (isAudioExpanded ?? false) : audioExpanded
    const toggleAudio = onAudioToggle
      ? () => onAudioToggle(!audioOpen)
      : () => setAudioExpanded(!audioExpanded)

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          {isImage && previewUrl ? (
            <img
              src={previewUrl}
              alt={value.name}
              className="h-8 w-8 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLightboxOpen(true)}
              title="Click to enlarge"
            />
          ) : (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={toggleAudio}
              title={audioOpen ? 'Hide player' : 'Show player'}
            >
              <FileAudio className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-20 truncate">{value.name}</span>
              {audioOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={handleRemove} title="Remove media">
            <X className="h-3 w-3" />
          </Button>
        </div>
        {/* Only render audio internally when NOT externally controlled */}
        {!onAudioToggle && audioOpen && !isImage && previewUrl && (
          <audio controls src={previewUrl} className="w-full max-w-48 h-8" />
        )}
        {lightboxOpen && previewUrl && (
          <Lightbox src={previewUrl} alt={value.name} onClose={() => setLightboxOpen(false)} />
        )}
      </div>
    )
  }

  // Full (non-compact) mode
  return (
    <div className="p-2 border rounded-md bg-muted/30">
      {isImage && previewUrl ? (
        <div className="flex items-center gap-3">
          <img
            src={previewUrl}
            alt={value.name}
            className="h-16 w-16 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setLightboxOpen(true)}
            title="Click to enlarge"
          />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs text-muted-foreground truncate">{value.name}</span>
            <span className="text-xs text-muted-foreground/60">Click image to enlarge</span>
          </div>
          <Button type="button" variant="ghost" size="icon" className="ml-auto h-6 w-6 shrink-0" onClick={handleRemove} title="Remove media">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : previewUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileAudio className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground truncate">{value.name}</span>
            <Button type="button" variant="ghost" size="icon" className="ml-auto h-6 w-6 shrink-0" onClick={handleRemove} title="Remove media">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <audio controls src={previewUrl} className="w-full" />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground italic">Loading preview...</span>
          <Button type="button" variant="ghost" size="icon" className="ml-auto h-6 w-6 shrink-0" onClick={handleRemove} title="Remove media">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {lightboxOpen && previewUrl && (
        <Lightbox src={previewUrl} alt={value.name} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  )
}
