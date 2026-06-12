export type VicksChangedFile = { status: 'A' | 'M' | 'D' | 'R'; path: string }
export type VicksDiff = { status: 'A' | 'M' | 'D' | 'R'; path: string; snippet: string }
export type ParsedVicksComment = {
  checklist: Array<{ label: string; done: boolean }>
  changedFiles: VicksChangedFile[]
  diffs: VicksDiff[]
  commits: string[]
}

export function formatDiffLines(snippet: string): string[] {
  const lines = String(snippet || '').split('\n')
  const parsed = lines.filter((line) => {
    if (line.startsWith('@@')) return true
    if (line.startsWith('Binary files ')) return true
    if (line.startsWith('+++') || line.startsWith('---')) return false
    if (line.startsWith('+') || line.startsWith('-')) return true
    return false
  })

  if (parsed.length > 0) return parsed

  return lines.filter((line) => {
    if (!line.trim()) return false
    if (line.startsWith('diff --git')) return false
    if (line.startsWith('index ')) return false
    if (line.startsWith('new file mode')) return false
    if (line.startsWith('deleted file mode')) return false
    if (line.startsWith('rename from ')) return false
    if (line.startsWith('rename to ')) return false
    return true
  })
}

export function parseHunkHeader(line: string): {
  oldStart: string
  oldCount: string
  newStart: string
  newCount: string
  context: string
} | null {
  const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/)
  if (!match) return null
  return {
    oldStart: match[1],
    oldCount: match[2] || '1',
    newStart: match[3],
    newCount: match[4] || '1',
    context: (match[5] || '').trim(),
  }
}

export function parseBinaryDiffLine(line: string): { fromPath: string; toPath: string } | null {
  const match = line.match(/^Binary files\s+(.+?)\s+and\s+(.+?)\s+differ$/)
  if (!match) return null
  const fromPath = match[1].replace(/^a\//, '').trim()
  const toPath = match[2].replace(/^b\//, '').trim()
  return { fromPath, toPath }
}

export function parseVicksComment(commentText: string): ParsedVicksComment | null {
  const text = String(commentText || '').trim()
  if (!text) return null
  if (!/##\s*Checklist/i.test(text)) return null

  const between = (start: RegExp, end: RegExp) => {
    const startMatch = text.match(start)
    if (!startMatch || startMatch.index == null) return ''
    const from = startMatch.index + startMatch[0].length
    const tail = text.slice(from)
    const endMatch = tail.match(end)
    return endMatch && endMatch.index != null ? tail.slice(0, endMatch.index) : tail
  }

  const checklistBlock = between(/##\s*Checklist\s*/i, /\n##\s+/)
  const checklist = checklistBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s*\[[ xX]\]/.test(line))
    .map((line) => {
      const done = /-\s*\[[xX]\]/.test(line)
      const label = line.replace(/^-\s*\[[ xX]\]\s*/, '').trim()
      return { label, done }
    })

  const changedFilesBlock = between(/##\s*Archivos cambiados\s*/i, /\n##\s+/)
  const changedFiles = changedFilesBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => {
      const m = line.match(/-\s*`?([AMDR])`?\s*`?([^`]+)`?/) || line.match(/-\s*([AMDR])\s+(.+)/)
      if (!m) return null
      return { status: m[1] as 'A' | 'M' | 'D' | 'R', path: m[2].trim() }
    })
    .filter((item): item is VicksChangedFile => Boolean(item))

  const diffBlock = between(/##\s*Diff parseado\s*/i, /\n##\s+/)
  const diffMatches = [...diffBlock.matchAll(/###\s*`?([AMDR])`?\s*`([^`]+)`\s*\n```diff\n([\s\S]*?)\n```/g)]
  const diffs = diffMatches.map((m) => ({
    status: m[1] as 'A' | 'M' | 'D' | 'R',
    path: m[2].trim(),
    snippet: m[3].trim(),
  }))

  const commitsBlock = between(/##\s*Commits\s*/i, /\n##\s+/)
  const commits = commitsBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)

  if (!checklist.length && !changedFiles.length && !diffs.length && !commits.length) {
    return null
  }

  return { checklist, changedFiles, diffs, commits }
}
