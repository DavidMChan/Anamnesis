import { useState, useEffect } from 'react'
import { getMediaUrl } from '@/lib/media'
import type { MediaAttachment } from '@/types/database'
import { FileAudio } from 'lucide-react'

interface MediaPreviewProps {
  media: MediaAttachment
  /** Compact mode for inline display next to options */
  compact?: boolean
}

export function MediaPreview({ media, compact = false }: MediaPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)

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
    if (isImage) {
      return <img src={url} alt={media.name} className="h-6 w-6 rounded object-cover inline-block" />
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <FileAudio className="h-3 w-3" />
        <span className="max-w-16 truncate">{media.name}</span>
      </span>
    )
  }

  if (isImage) {
    return <img src={url} alt={media.name} className="max-w-xs max-h-48 rounded" />
  }

  return (
    <div className="flex items-center gap-2">
      <FileAudio className="h-4 w-4 text-muted-foreground" />
      <audio controls src={url} className="h-8" />
      <span className="text-xs text-muted-foreground">{media.name}</span>
    </div>
  )
}
