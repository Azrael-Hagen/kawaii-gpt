import changelogRaw from '../../../../CHANGELOG.md?raw'
import type { ReleaseKnowledgeEntry, Settings } from '@/types'

function parseBulletLines(section: string): string[] {
  return section
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
}

export function parseReleaseKnowledge(markdown: string): ReleaseKnowledgeEntry[] {
  const chunks = markdown.split(/\n## \[/).filter(Boolean)

  return chunks.map((chunk, index) => {
    const normalized = index === 0 ? chunk : `[${chunk}`
    const headerMatch = normalized.match(/^\[(.+?)\]\s+-\s+(\d{4}-\d{2}-\d{2})/m)
    const version = headerMatch?.[1] ?? 'unknown'
    const date = headerMatch?.[2] ?? ''

    const addedMatch = normalized.match(/### Added([\s\S]*?)(?:\n### |$)/)
    const changedMatch = normalized.match(/### Changed([\s\S]*?)(?:\n### |$)/)
    const fixedMatch = normalized.match(/### Fixed([\s\S]*?)(?:\n### |$)/)

    return {
      version,
      date,
      added: parseBulletLines(addedMatch?.[1] ?? ''),
      changed: parseBulletLines(changedMatch?.[1] ?? ''),
      fixed: parseBulletLines(fixedMatch?.[1] ?? ''),
      learnedAt: Date.now(),
    }
  }).filter(entry => entry.version !== 'unknown')
}

export function ingestReleaseKnowledge(settings: Settings, currentVersion: string): ReleaseKnowledgeEntry[] {
  const parsed = parseReleaseKnowledge(changelogRaw)
  const knownVersions = new Set((settings.releaseKnowledgeBase ?? []).map(item => item.version))
  const merged = [...(settings.releaseKnowledgeBase ?? [])]

  for (const entry of parsed) {
    if (!knownVersions.has(entry.version)) {
      merged.push(entry)
      knownVersions.add(entry.version)
    }
  }

  return merged
    .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, 20)
}

export function summarizeReleaseKnowledge(settings: Settings, currentVersion: string): string {
  const release = (settings.releaseKnowledgeBase ?? []).find(item => item.version === currentVersion)
  if (!release) return ''

  const parts = [
    release.added.length > 0 ? `Added: ${release.added.join('; ')}` : '',
    release.changed.length > 0 ? `Changed: ${release.changed.join('; ')}` : '',
    release.fixed.length > 0 ? `Fixed: ${release.fixed.join('; ')}` : '',
  ].filter(Boolean)

  return parts.join(' | ')
}
