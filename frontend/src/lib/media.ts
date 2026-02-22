import { supabase } from './supabase'
import type { MediaAttachment } from '@/types/database'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB

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
 * Upload a file to Wasabi via Edge Function presigned URL.
 *
 * Flow:
 * 1. Call Edge Function to get presigned PUT URL + object key
 * 2. PUT file directly to Wasabi
 * 3. Return MediaAttachment with key, type, name
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

  // Get presigned upload URL from Edge Function
  const { data, error } = await supabase.functions.invoke('media-upload-url', {
    body: { filename: file.name, contentType: file.type },
  })

  if (error) {
    throw new Error(`Failed to get upload URL: ${error.message}`)
  }

  const { uploadUrl, key } = data as { uploadUrl: string; key: string }

  // Upload file directly to Wasabi via presigned URL
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  })

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.statusText}`)
  }

  return {
    key,
    type: file.type,
    name: file.name,
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
