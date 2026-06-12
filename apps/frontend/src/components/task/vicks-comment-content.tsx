import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ParsedVicksComment } from '@/utils/diff-parser'
import { formatDiffLines, parseHunkHeader, parseBinaryDiffLine } from '@/utils/diff-parser'

type Tab = 'files' | 'diffs' | 'commits'

export function VicksCommentContent({ parsed }: { parsed: ParsedVicksComment }) {
  const [tab, setTab] = useState<Tab>('diffs')
  const tabBase = 'px-2.5 py-1 rounded-md text-[11px] sm:text-xs border transition-colors'

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Checklist</div>
        <div className="space-y-1.5">
          {parsed.checklist.length === 0 ? (
            <div className="text-xs text-text-muted">No checklist available</div>
          ) : (
            parsed.checklist.map((item, idx) => (
              <div key={`${item.label}-${idx}`} className="flex items-center gap-2 text-xs sm:text-sm">
                <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded border text-[10px]', item.done ? 'border-success text-success' : 'border-text-muted text-text-muted')}>
                  {item.done ? 'x' : '-'}
                </span>
                <span className={cn(item.done ? 'text-text-primary' : 'text-text-muted')}>{item.label}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border-default pt-2.5">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setTab('diffs')}
            className={cn(tabBase, tab === 'diffs' ? 'border-accent-primary text-text-primary bg-surface-default/60' : 'border-border-default text-text-muted')}
          >
            Diff ({parsed.diffs.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('files')}
            className={cn(tabBase, tab === 'files' ? 'border-accent-primary text-text-primary bg-surface-default/60' : 'border-border-default text-text-muted')}
          >
            Archivos ({parsed.changedFiles.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('commits')}
            className={cn(tabBase, tab === 'commits' ? 'border-accent-primary text-text-primary bg-surface-default/60' : 'border-border-default text-text-muted')}
          >
            Commits ({parsed.commits.length})
          </button>
        </div>

        {tab === 'diffs' ? (
          parsed.diffs.length === 0 ? (
            <div className="text-xs text-text-muted">No parsed diff</div>
          ) : (
            <div className="space-y-2.5">
              {parsed.diffs.map((diff, idx) => (
                <div key={`${diff.path}-${idx}`} className="rounded-md border border-border-default/50 bg-surface-default/40 p-2">
                  <div className="mb-1.5 flex items-center gap-2 text-xs">
                    <span className="w-5 text-center rounded bg-surface-default text-text-primary font-mono text-[10px] sm:text-xs">{diff.status}</span>
                    <span className="font-mono text-text-secondary break-all">{diff.path}</span>
                  </div>
                  <div className="max-h-44 overflow-auto rounded bg-surface-default/70 p-2">
                    <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
                      {formatDiffLines(diff.snippet).map((line, lineIdx) => (
                        (() => {
                          const binary = parseBinaryDiffLine(line)
                          if (binary) {
                            return (
                              <div
                                key={`${diff.path}-${idx}-${lineIdx}`}
                                className="my-1 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1.5"
                              >
                                <div className="text-[10px] sm:text-xs font-medium text-amber-300">
                                  Binary file changed
                                </div>
                                <div className="mt-1 text-[11px] text-text-secondary font-mono break-all">
                                  {binary.toPath || binary.fromPath}
                                </div>
                              </div>
                            )
                          }

                          const hunk = parseHunkHeader(line)
                          if (hunk) {
                            return (
                              <div
                                key={`${diff.path}-${idx}-${lineIdx}`}
                                className="my-1 rounded-md border border-border-default/60 bg-surface-default/80 px-2 py-1"
                              >
                                <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-xs">
                                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">-{hunk.oldStart},{hunk.oldCount}</span>
                                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">+{hunk.newStart},{hunk.newCount}</span>
                                </div>
                                {hunk.context ? (
                                  <div className="mt-1 text-[11px] text-text-muted break-all">{hunk.context}</div>
                                ) : null}
                              </div>
                            )
                          }

                          return (
                            <div
                              key={`${diff.path}-${idx}-${lineIdx}`}
                              className={cn(
                                'break-all',
                                line.startsWith('+') && !line.startsWith('+++') && 'text-emerald-400',
                                line.startsWith('-') && !line.startsWith('---') && 'text-rose-400',
                                !line.startsWith('+') && !line.startsWith('-') && 'text-text-secondary',
                              )}
                            >
                              {line}
                            </div>
                          )
                        })()
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === 'files' ? (
          parsed.changedFiles.length === 0 ? (
            <div className="text-xs text-text-muted">No changed files</div>
          ) : (
            <div className="space-y-1.5">
              {parsed.changedFiles.map((file, idx) => (
                <div key={`${file.path}-${idx}`} className="flex items-center gap-2 rounded-md border border-border-default/50 bg-surface-default/40 px-2 py-1.5 text-xs sm:text-sm">
                  <span className="w-5 text-center rounded bg-surface-default text-text-primary font-mono text-[10px] sm:text-xs">{file.status}</span>
                  <span className="font-mono text-text-secondary break-all">{file.path}</span>
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === 'commits' ? (
          parsed.commits.length === 0 ? (
            <div className="text-xs text-text-muted">No commits listed</div>
          ) : (
            <div className="space-y-1.5">
              {parsed.commits.map((commit, idx) => (
                <div key={`${commit}-${idx}`} className="rounded-md border border-border-default/50 bg-surface-default/40 px-2 py-1.5 text-xs sm:text-sm font-mono text-text-secondary break-all">
                  {commit}
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}
