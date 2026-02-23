import { supabase } from './supabase'
import type { MediaAttachment } from '@/types/database'

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500 MB

const ACCEPTABLE_TYPES = ['image/', 'audio/']

/**
 * Check if a file is an acceptable media type (image or audio).
 */
export function isAcceptableMediaType(file: File): boolean {
  return ACCEPTABLE_TYPES.some((prefix) => file.type.startsWith(prefix))
}

/**
 * Human-readable file size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Upload a file to Wasabi via presigned POST.
 *
 * Flow:
 * 1. Call Edge Function to get presigned POST URL + form fields
 * 2. POST file as FormData directly to Wasabi (no CORS config needed — Wasabi auto-handles it)
 * 3. Return MediaAttachment with key, type, name
 *
 * Uses the same mechanism as boto3's generate_presigned_post.
 */
export async function uploadMedia(file: File): Promise<MediaAttachment> {
  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${formatFileSize(file.size)}). Maximum size is 25 MB.`)
  }

  // Validate file type
  if (!isAcceptableMediaType(file)) {
    throw new Error(`Unsupported file type: ${file.type}. Only images and audio files are accepted.`)
  }

  // Get presigned POST URL + fields from Edge Function
  const { data, error } = await supabase.functions.invoke('media-upload-url', {
    body: { filename: file.name, contentType: file.type },
  })

  if (error) {
    throw new Error(`Failed to get upload URL: ${error.message}`)
  }

  const { url, fields, key } = data as { url: string; fields: Record<string, string>; key: string }

  // Build FormData with policy fields + file (file MUST be last)
  const formData = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    formData.append(k, v)
  }
  formData.append('file', file)

  // POST directly to Wasabi
  const uploadResponse = await fetch(url, {
    method: 'POST',
    body: formData,
  })

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => '')
    throw new Error(`Upload failed (${uploadResponse.status}): ${text}`)
  }

  return {
    key,
    type: file.type,
    name: file.name,
  }
}

/**
 * Delete a media object from Wasabi storage.
 * Fire-and-forget safe — callers may choose not to await.
 */
export async function deleteMedia(key: string): Promise<void> {
  const { error } = await supabase.functions.invoke('media-delete', {
    body: { key },
  })

  if (error) {
    console.error(`Failed to delete media ${key}:`, error.message)
  }
}

/**
 * Copy a media object in Wasabi (server-side, no download).
 * Returns a new MediaAttachment with a fresh key but same type/name.
 */
export async function copyMedia(attachment: MediaAttachment): Promise<MediaAttachment> {
  const { data, error } = await supabase.functions.invoke('media-copy', {
    body: { sourceKey: attachment.key },
  })

  if (error) {
    throw new Error(`Failed to copy media: ${error.message}`)
  }

  return {
    key: (data as { key: string }).key,
    type: attachment.type,
    name: attachment.name,
  }
}

/**
 * Get a displayable URL for a media attachment.
 * Returns a presigned GET URL from the Edge Function (1-hour expiry).
 */
export async function getMediaUrl(key: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('media-get-url', {
    body: { key },
  })

  if (error) {
    throw new Error(`Failed to get media URL: ${error.message}`)
  }

  return (data as { url: string }).url
}
