export function parseChallengeStringList(raw?: string) {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter(item => typeof item === 'string' && item.trim().length > 0)
    }
  }
  catch {
    // Fall back to plain text when the field is not valid JSON yet.
  }

  return raw.split('\n').map(item => item.trim()).filter(Boolean)
}

export function hasChallengeContent(options: {
  description?: string | null
  hints?: string
  attachments?: string
}) {
  return Boolean(options.description)
    || parseChallengeStringList(options.hints).length > 0
    || parseChallengeStringList(options.attachments).length > 0
}

export function getChallengeHints(raw?: string) {
  return parseChallengeStringList(raw)
}

export function getChallengeAttachments(raw?: string) {
  return parseChallengeStringList(raw)
}

export function getChallengeAttachmentDisplayName(attachment: string, index: number) {
  const trimmed = attachment.trim()
  if (!trimmed) {
    return `附件 ${index + 1}`
  }

  const normalized = trimmed.split('?')[0]?.split('#')[0] || trimmed
  const segment = normalized.split('/').filter(Boolean).pop() || ''
  if (!segment) {
    return `附件 ${index + 1}`
  }

  if (segment.startsWith('attachments') || segment === 'attachments') {
    return `附件 ${index + 1}`
  }

  const fileName = decodeURIComponent(segment)
  const dashIndex = fileName.indexOf('-')
  if (/^\d+$/.test(fileName.slice(0, dashIndex)) && dashIndex > 0) {
    return fileName.slice(dashIndex + 1) || `附件 ${index + 1}`
  }

  return fileName
}

export function getChallengeAttachmentMeta(attachment: string) {
  if (attachment.startsWith('/attachments/')) {
    return {
      badge: '本地附件',
      color: 'info' as const,
    }
  }

  return {
    badge: '外部链接',
    color: 'neutral' as const,
  }
}
