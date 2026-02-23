import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getMediaUrl } from '@/lib/media'
import type { MediaAttachment } from '@/types/database'
import { FileAudio, X, ChevronDown, ChevronUp } from 'lucide-react'

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

interface MediaPreviewProps {
  media: MediaAttachment
  /** Compact mode for inline display next to options */
  compact?: boolean
  /** External control for audio expand (compact mode only). When provided, audio player is NOT rendered internally. */
  isAudioExpanded?: boolean
  onAudioToggle?: (expanded: boolean) => void
}

export function MediaPreview({ media, compact = false, isAudioExpanded, onAudioToggle }: MediaPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    getMediaUrl(media.key)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => {
        // Silently fail — preview not critical
      })
    return () => { cancelled = true }
  }, [media.key])

  if (!url) {
    return (
      <span className="text-xs text-muted-foreground italic">Loading...</span>
    )
  }

  const isImage = media.type.startsWith('image/')

  if (compact) {
    // Use external control if provided, else internal state
    const audioOpen = onAudioToggle ? (isAudioExpanded ?? false) : audioExpanded
    const toggleAudio = onAudioToggle
      ? () => onAudioToggle(!audioOpen)
      : () => setAudioExpanded(!audioExpanded)

    return (
      <span className="inline-flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5">
          {isImage ? (
            <img
              src={url}
              alt={media.name}
              className="h-6 w-6 rounded object-cover inline-block cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLightboxOpen(true)}
              title="Click to enlarge"
            />
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              onClick={toggleAudio}
              title={audioOpen ? 'Hide player' : 'Play audio'}
            >
              <FileAudio className="h-3.5 w-3.5" />
              <span className="text-xs max-w-16 truncate">{media.name}</span>
              {audioOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </span>
        {/* Only render audio internally when NOT externally controlled */}
        {!onAudioToggle && audioOpen && !isImage && (
          <audio controls src={url} className="w-full max-w-48 h-8" />
        )}
        {lightboxOpen && isImage && (
          <Lightbox src={url} alt={media.name} onClose={() => setLightboxOpen(false)} />
        )}
      </span>
    )
  }

  // Non-compact mode
  if (isImage) {
    return (
      <>
        <img
          src={url}
          alt={media.name}
          className="max-w-xs max-h-48 rounded cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => setLightboxOpen(true)}
          title="Click to enlarge"
        />
        {lightboxOpen && (
          <Lightbox src={url} alt={media.name} onClose={() => setLightboxOpen(false)} />
        )}
      </>
    )
  }

  // Audio — non-compact
  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center gap-2">
        <FileAudio className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground">{media.name}</span>
      </div>
      <audio controls src={url} className="w-full max-w-sm" />
    </div>
  )
}
