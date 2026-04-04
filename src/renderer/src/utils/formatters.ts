/**
 * Trim a string to a max length and append ellipsis if truncated.
 */
export function truncate(str: string, max = 40): string {
  const trimmed = str.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/**
 * Generate a conversation title from the first user message.
 */
export function titleFromMessage(content: string): string {
  return truncate(content.replace(/\n/g, ' ').trim(), 40) || 'New Chat'
}

/**
 * Format a Unix timestamp (ms) to a human-readable time string.
 */
export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour:   '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

/**
 * Format a Unix timestamp (ms) to a long, human-readable date+time string.
 */
export function formatDateTimeLong(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

/**
 * Format a Unix timestamp (ms) to a relative date label.
 */
export function formatRelativeDate(ms: number): string {
  const now   = Date.now()
  const delta = now - ms
  const day   = 86_400_000

  if (delta < day)     return 'Today'
  if (delta < 2 * day) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms))
}

/**
 * Format model size from bytes to a human-readable string.
 */
export function formatModelSize(bytes: number): string {
  const gb = bytes / 1_073_741_824
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`
  return formatModelSize(bytes)
}
