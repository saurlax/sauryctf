type ChallengeInstanceLink = {
  label: string
  url: string
}

type ChallengeInstanceSpec = {
  note: string
  url: string
  host: string
  port: string
  command: string
  links: ChallengeInstanceLink[]
  runtimeProvider: string
  runtimeImage: string
  runtimeExpose: string[]
  raw: string
}

function toTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => toTrimmedString(item))
    .filter(Boolean)
}

export function parseChallengeInstanceSpec(raw?: string): ChallengeInstanceSpec | null {
  const source = toTrimmedString(raw)
  if (!source) {
    return null
  }

  try {
    const parsed = JSON.parse(source)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, any>
      const connection = record.connection && typeof record.connection === 'object' ? record.connection as Record<string, any> : {}
      const runtime = record.runtime && typeof record.runtime === 'object' ? record.runtime as Record<string, any> : {}
      const links = Array.isArray(record.links)
        ? record.links
          .map(item => {
            if (!item || typeof item !== 'object') {
              return null
            }

            const label = toTrimmedString((item as Record<string, any>).label)
            const url = toTrimmedString((item as Record<string, any>).url)
            if (!url) {
              return null
            }

            return {
              label: label || '实例链接',
              url,
            }
          })
          .filter((item): item is ChallengeInstanceLink => Boolean(item))
        : []

      return {
        note: toTrimmedString(connection.note),
        url: toTrimmedString(connection.url),
        host: toTrimmedString(connection.host),
        port: connection.port === undefined || connection.port === null ? '' : String(connection.port).trim(),
        command: toTrimmedString(connection.command),
        links,
        runtimeProvider: toTrimmedString(runtime.provider),
        runtimeImage: toTrimmedString(runtime.image),
        runtimeExpose: toStringList(runtime.expose),
        raw: source,
      }
    }
  }
  catch {
    // Keep compatibility with older free-form text specs.
  }

  return {
    note: source,
    url: '',
    host: '',
    port: '',
    command: '',
    links: [],
    runtimeProvider: '',
    runtimeImage: '',
    runtimeExpose: [],
    raw: source,
  }
}

export function hasChallengeInstanceSpec(raw?: string) {
  const spec = parseChallengeInstanceSpec(raw)
  if (!spec) {
    return false
  }

  return Boolean(
    spec.note
    || spec.url
    || spec.host
    || spec.port
    || spec.command
    || spec.links.length
    || spec.runtimeProvider
    || spec.runtimeImage
    || spec.runtimeExpose.length,
  )
}
