import { useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface MarkdownContentProps {
  content: string
  compact?: boolean
  size?: 'sm' | 'xs'
}

interface InlineImageRef {
  src: string
  alt: string
}

function parseDiffSections(diffText: string, maxFiles = 8, maxLinesPerFile = 30) {
  const lines = diffText.split('\n')
  const sections: Array<{ status: 'A' | 'M' | 'D' | 'R'; path: string; snippet: string }> = []

  let currentPath = ''
  let currentLines: string[] = []

  const flush = () => {
    if (!currentPath) return
    const text = currentLines.join('\n')
    let status: 'A' | 'M' | 'D' | 'R' = 'M'
    if (text.includes('new file mode')) status = 'A'
    else if (text.includes('deleted file mode')) status = 'D'
    else if (text.includes('rename from ') || text.includes('rename to ')) status = 'R'

    const snippetLines = currentLines.slice(0, Math.max(1, maxLinesPerFile))
    if (currentLines.length > maxLinesPerFile) snippetLines.push('... (truncated)')
    sections.push({ status, path: currentPath, snippet: snippetLines.join('\n').trim() })
    currentPath = ''
    currentLines = []
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      const parts = line.split(' ')
      if (parts.length >= 4) {
        const fromPath = parts[2].startsWith('a/') ? parts[2].slice(2) : parts[2]
        const toPath = parts[3].startsWith('b/') ? parts[3].slice(2) : parts[3]
        currentPath = toPath && toPath !== '/dev/null' ? toPath : fromPath
      } else {
        currentPath = '(unknown file)'
      }
    }
    if (currentPath) currentLines.push(line)
  }

  flush()
  return sections.slice(0, Math.max(1, maxFiles))
}

function prettifyLegacyVicksComment(content: string): string {
  const text = (content || '').trim()
  if (!text) return text
  if (text.includes('## Resumen') && text.includes('## Diff parseado')) return text
  if (!/ready for qa/i.test(text) || !/```diff[\s\S]*```/i.test(text)) return text

  const timestampMatch = text.match(/Ready for QA\s*\(([^)]+)\)/i)
  const filesSummaryMatch = text.match(/-\s*(\d+)\s+files?,\s*([^\n]+)/i)
  const commitsSummaryMatch = text.match(/-\s*(\d+)\s+commits?/i)
  const createdFilesMatch = text.match(/-\s*Created files:\s*([^\n]+)/i)

  const diffMatch = text.match(/```diff\n([\s\S]*?)\n```/i)
  const diffText = diffMatch?.[1]?.trim() || ''
  const sections = diffText ? parseDiffSections(diffText) : []

  const changedFiles = sections.length
    ? sections.map((s) => `- \`${s.status}\` \`${s.path}\``).join('\n')
    : '- No changed files detected'

  const parsedDiff = sections.length
    ? sections
        .map((s) => `### \`${s.status}\` \`${s.path}\`\n\n\`\`\`diff\n${s.snippet}\n\`\`\``)
        .join('\n\n')
    : `\`\`\`diff\n${diffText || 'No diff patch preview available'}\n\`\`\``

  const summaryFiles = filesSummaryMatch ? `${filesSummaryMatch[1]} files changed, ${filesSummaryMatch[2]}` : 'Diff generated'
  const summaryCommits = commitsSummaryMatch ? `${commitsSummaryMatch[1]} commits` : 'Commits summary unavailable'
  const createdLine = createdFilesMatch ? `\n- Created files: ${createdFilesMatch[1]}` : ''
  const timestamp = timestampMatch?.[1] || 'unknown time'

  return [
    '## Resumen',
    `- Implementation complete. Ready for QA (${timestamp}).`,
    `- ${summaryFiles}.`,
    `- ${summaryCommits}.${createdLine}`,
    '',
    '## Archivos cambiados',
    changedFiles,
    '',
    '## Diff parseado',
    parsedDiff,
  ].join('\n')
}

function normalizeImageSrc(src?: string): string {
  const value = String(src || '').trim()
  if (!value) return value
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return value
  return value
}

export function MarkdownContent({ content, compact = false, size = 'sm' }: MarkdownContentProps) {
  const proseSizeClass = size === 'xs' ? '[&_*]:text-xs' : 'prose-sm'
  const parsedContent = useMemo(() => prettifyLegacyVicksComment(content), [content])
  const [inlineImage, setInlineImage] = useState<InlineImageRef | null>(null)

  const renderLink = ({ children, href }: { children?: ReactNode; href?: string }) => {
    const target = normalizeImageSrc(href)
    if (!target) {
      return <span>{children}</span>
    }
    return (
      <a
        href={target}
        className="text-accent-primary hover:text-accent-secondary underline transition-colors"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  }

  return (
    <>
      <div className={`prose prose-invert ${proseSizeClass} max-w-none text-text-secondary break-words [overflow-wrap:anywhere]`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h1 className="text-xl font-bold text-text-primary mt-4 mb-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-semibold text-text-primary mt-3 mb-2">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-medium text-text-primary mt-2 mb-1">{children}</h3>,
            p: ({ children }) => (
              <p className={compact ? 'm-0 leading-relaxed break-words [overflow-wrap:anywhere]' : 'mb-2 leading-relaxed break-words [overflow-wrap:anywhere]'}>{children}</p>
            ),
            ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
            li: ({ children }) => <li className="text-text-secondary break-words [overflow-wrap:anywhere]">{children}</li>,
            code: ({ children, className }) => {
              const isInline = !className
              return isInline ? (
                <code className="bg-surface-default px-1 py-0.5 rounded text-accent-secondary text-xs font-mono break-all">
                  {children}
                </code>
              ) : (
                <pre className={compact ? 'bg-surface-default p-2 rounded-lg whitespace-pre-wrap break-words my-2' : 'bg-surface-default p-3 rounded-lg overflow-x-auto my-3'}>
                  <code className="text-accent-secondary text-xs font-mono">{children}</code>
                </pre>
              )
            },
            a: renderLink,
            img: ({ src, alt }) => {
              const normalizedSrc = normalizeImageSrc(src)
              if (!normalizedSrc) return null
              const label = String(alt || 'QA screenshot')
              return (
                <button
                  type="button"
                  onClick={() => setInlineImage({ src: normalizedSrc, alt: label })}
                  className="group block w-full max-w-full rounded-md border border-border-default/60 bg-surface-default/40 p-2 my-2 text-left"
                >
                  <img
                    src={normalizedSrc}
                    alt={label}
                    className="h-44 sm:h-56 w-full rounded object-cover bg-surface-default"
                    loading="lazy"
                  />
                  <div className="mt-1 text-[11px] text-text-muted group-hover:text-text-primary transition-colors">
                    Click to expand
                  </div>
                </button>
              )
            },
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-accent-primary pl-4 italic text-text-muted my-3">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="border-border-default my-4" />,
          }}
        >
          {parsedContent}
        </ReactMarkdown>
      </div>

      <Dialog open={Boolean(inlineImage)} onOpenChange={(open) => {
        if (!open) setInlineImage(null)
      }}>
        <DialogContent className="w-[96vw] max-w-5xl p-2 sm:p-4 bg-bg-card border-border-default">
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base text-text-primary">
              {inlineImage?.alt || 'Screenshot preview'}
            </DialogTitle>
            <DialogDescription className="sr-only">Screenshot preview</DialogDescription>
          </DialogHeader>
          {inlineImage ? (
            <div className="max-h-[80vh] overflow-auto rounded-md bg-surface-default/40 p-1">
              <img
                src={inlineImage.src}
                alt={inlineImage.alt}
                className="w-full h-auto rounded object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
