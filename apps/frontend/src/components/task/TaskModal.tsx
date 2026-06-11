import { useState, useEffect, useMemo, useRef, useCallback, type UIEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  GitBranch,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusBadge, PriorityBadge, AgentBadge } from '@/components/common/StatusBadge'
import { LoadingSpinner, EmptyState } from '@/components/common/LoadingSpinner'
import { MarkdownContent } from '@/components/common/MarkdownContent'
import { useProjectStore } from '@/stores/projectStore'
import { useAgentStore } from '@/stores/agentStore'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import { tasksApi, commentsApi } from '@/lib/api'
import { STATUS_META, STATUSES, ALLOWED_TRANSITIONS, type TaskStatus } from '@/lib/constants'
import { formatRelativeTime } from '@/lib/utils'
import type { Task, TaskComment } from '@/types/models'
import type { QaEvidenceEntry } from '@/lib/api'
import { cn } from '@/lib/utils'

interface QaPreviewImage {
  src: string
  alt: string
}

const COMMENTS_PAGE_SIZE = 5

// Animated container variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
    },
  },
}

type VicksChangedFile = { status: 'A' | 'M' | 'D' | 'R'; path: string }
type VicksDiff = { status: 'A' | 'M' | 'D' | 'R'; path: string; snippet: string }
type ParsedVicksComment = {
  checklist: Array<{ label: string; done: boolean }>
  changedFiles: VicksChangedFile[]
  diffs: VicksDiff[]
  commits: string[]
}

function formatDiffLines(snippet: string): string[] {
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

function parseHunkHeader(line: string): {
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

function parseBinaryDiffLine(line: string): { fromPath: string; toPath: string } | null {
  const match = line.match(/^Binary files\s+(.+?)\s+and\s+(.+?)\s+differ$/)
  if (!match) return null
  const fromPath = match[1].replace(/^a\//, '').trim()
  const toPath = match[2].replace(/^b\//, '').trim()
  return { fromPath, toPath }
}

function parseVicksComment(commentText: string): ParsedVicksComment | null {
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

function VicksCommentContent({ parsed }: { parsed: ParsedVicksComment }) {
  const [tab, setTab] = useState<'files' | 'diffs' | 'commits'>('diffs')
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

// Task Header Section with enhanced animations
function TaskHeader({ task, project }: { task: Task; project: { name: string } }) {
  return (
    <motion.div 
      className="space-y-1.5 sm:space-y-2"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <motion.div 
        className="flex items-center gap-1.5 text-[10px] sm:text-xs text-text-muted"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        <span className="truncate max-w-[120px] sm:max-w-[200px]">{project.name}</span>
        <ChevronRight className="h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" />
        <span className="font-mono">#{task.id.slice(-6)}</span>
      </motion.div>

      <motion.h2 
        className="text-base sm:text-lg lg:text-xl font-semibold text-text-primary leading-tight"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15 }}
      >
        {task.title}
      </motion.h2>

      <motion.div 
        className="flex flex-wrap items-center gap-2 sm:gap-3 pt-1 sm:pt-2"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
      >
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <StatusBadge status={task.status} size="sm" />
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <PriorityBadge priority={task.priority} size="sm" />
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="hidden xs:block">
          <AgentBadge agent={task.assigned_to || ''} size="sm" />
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

// Task Description Section with fade in
function TaskDescription({ description }: { description?: string }) {
  if (!description) {
    return (
      <motion.div 
        className="text-text-muted text-sm italic"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        No description provided
      </motion.div>
    )
  }

  return (
    <motion.div 
      className="max-w-none"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
    >
      <MarkdownContent content={description} />
    </motion.div>
  )
}

// Task Metadata Section with staggered animations
function TaskMetadata({ task }: { task: Task }) {
  return (
    <motion.div 
      className="space-y-2 sm:space-y-3"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="space-y-1.5 sm:space-y-2">
        {task.workspace_path ? (
          <motion.div 
            className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2 text-xs sm:text-sm"
            variants={itemVariants}
          >
            <div className="text-text-muted shrink-0">Workspace:</div>
            <div className="text-text-secondary font-mono text-[10px] sm:text-xs break-all">
              {task.workspace_path}
            </div>
          </motion.div>
        ) : null}

        {(Number(task.escalation_count || 0) > 0 || Number(task.requeue_count || 0) > 0) ? (
          <motion.div
            className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs text-text-muted"
            variants={itemVariants}
          >
            <span className="rounded border border-border-default/60 bg-surface-default/40 px-2 py-0.5">
              Escalations: {Number(task.escalation_count || 0)}
            </span>
            <span className="rounded border border-border-default/60 bg-surface-default/40 px-2 py-0.5">
              Requeues: {Number(task.requeue_count || 0)}
            </span>
            {task.last_escalated_at ? (
              <span>Last escalation: {formatRelativeTime(task.last_escalated_at)}</span>
            ) : null}
            {task.last_requeued_at ? (
              <span>Last requeue: {formatRelativeTime(task.last_requeued_at)}</span>
            ) : null}
          </motion.div>
        ) : null}

        {task.work_branch ? (
          <motion.div 
            className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
            variants={itemVariants}
          >
            <GitBranch className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-text-muted shrink-0" />
            <span className="text-text-secondary font-mono text-xs sm:text-sm truncate">{task.work_branch}</span>
          </motion.div>
        ) : null}
      </div>

      <motion.hr 
        className="border-border-default" 
        variants={itemVariants}
      />

      <motion.div variants={itemVariants}>
        <TaskStatusActions task={task} />
      </motion.div>
    </motion.div>
  )
}

// Task Status Actions with hover effects
function TaskStatusActions({ task }: { task: Task }) {
  const { moveTask } = useProjectStore()
  const { addToast } = useToastStore()
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [showQaChecklist, setShowQaChecklist] = useState(false)
  const [showQaRejection, setShowQaRejection] = useState(false)
  const [qaChecklist, setQaChecklist] = useState({
    scope_complete: false,
    self_review_done: false,
    tests_passed: false,
    diff_attached: false,
  })
  const [qaRejection, setQaRejection] = useState({
    root_cause: '',
    repro_steps: '',
    impacted_files: '',
    failed_checks: '',
    extra_notes: '',
  })

  const currentIndex = STATUSES.indexOf(task.status)
  const nextStatus = STATUSES[currentIndex + 1] as TaskStatus | undefined
  const prevStatus = STATUSES[currentIndex - 1] as TaskStatus | undefined

  const canMoveForward =
    nextStatus &&
    ALLOWED_TRANSITIONS.has(`${task.status}:${nextStatus}`) &&
    !(task.status === 'qa' && nextStatus === 'done' && !task.release_approved)
  const canMoveBackward = prevStatus && ALLOWED_TRANSITIONS.has(`${task.status}:${prevStatus}`)
  const canApproveInQa =
    task.status === 'qa' &&
    !task.release_approved &&
    String(task.last_failure_reason || '').trim().length === 0

  const handleApproveQa = async () => {
    const approver = 'human'
    const branch = String(task.work_branch || task.approved_branch || '').trim()
    if (!branch) {
      addToast('error', 'Cannot approve: missing work branch')
      return
    }
    setIsApproving(true)
    try {
      await tasksApi.approveQa(task.id, {
        approved_by: approver,
        branch,
        push: false,
      })
      addToast('success', 'QA approved by human. Battlestation will close the task in done.')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Approval failed'
      addToast('error', message)
    } finally {
      setIsApproving(false)
    }
  }

  const handleTransition = async (
    toStatus: TaskStatus,
    payload?: {
      comment_text?: string
      qa_checklist?: {
        scope_complete?: boolean
        self_review_done?: boolean
        tests_passed?: boolean
        diff_attached?: boolean
      }
      qa_rejection?: {
        root_cause?: string
        repro_steps?: string
        impacted_files?: string
        failed_checks?: string[]
      }
    }
  ) => {
    setIsTransitioning(true)
    try {
      await moveTask(task.id, task.status, toStatus, payload)
      addToast('success', `Task moved to ${STATUS_META[toStatus].label}`)
      setShowQaChecklist(false)
      setShowQaRejection(false)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Transition failed'
      addToast('error', message)
    } finally {
      setIsTransitioning(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
        Actions
      </p>

      <div className="flex flex-wrap gap-2">
        {canMoveBackward && prevStatus ? (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            whileHover={{ scale: 1.05, x: -3 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={isTransitioning}
              onClick={() => {
                if (task.status === 'qa' && prevStatus === 'progress') {
                  setShowQaRejection((prev) => !prev)
                  return
                }
                handleTransition(prevStatus)
              }}
            >
              <ArrowLeft className="h-3 w-3 mr-1" />
              {STATUS_META[prevStatus].label}
            </Button>
          </motion.div>
        ) : null}

        {canMoveForward && nextStatus ? (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            whileHover={{ scale: 1.05, x: 3 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              size="sm"
              disabled={isTransitioning}
              onClick={() => {
                if (task.status === 'progress' && nextStatus === 'qa') {
                  setShowQaChecklist((prev) => !prev)
                  return
                }
                handleTransition(nextStatus)
              }}
              className="bg-accent-primary text-text-inverse shadow-glow"
            >
              {STATUS_META[nextStatus].label}
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </motion.div>
        ) : null}

        {canApproveInQa ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={isApproving}
              onClick={handleApproveQa}
              className="bg-success text-text-inverse shadow-lg"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Approve QA
            </Button>
          </motion.div>
        ) : null}
      </div>

      {task.status === 'progress' && canMoveForward && nextStatus === 'qa' && showQaChecklist ? (
        <div className="mt-2 rounded-lg border border-border-default bg-surface-default/40 p-3 space-y-3">
          <div className="text-xs font-medium text-text-primary">QA Checklist (required)</div>
          <div className="space-y-2">
            {[
              ['scope_complete', 'Scope implementation complete'],
              ['self_review_done', 'Self-review completed'],
              ['tests_passed', 'Relevant tests passed'],
              ['diff_attached', 'Diff evidence attached'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                <span>{label}</span>
                <Switch
                  checked={Boolean(qaChecklist[key as keyof typeof qaChecklist])}
                  onCheckedChange={(checked) =>
                    setQaChecklist((prev) => ({ ...prev, [key]: checked }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowQaChecklist(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                isTransitioning ||
                !Object.values(qaChecklist).every(Boolean)
              }
              onClick={() =>
                handleTransition('qa', {
                  comment_text:
                    'Implementation complete. Ready for QA. Diff attached and checklist completed.',
                  qa_checklist: qaChecklist,
                })
              }
            >
              Submit to QA
            </Button>
          </div>
        </div>
      ) : null}

      {task.status === 'qa' && canMoveBackward && prevStatus === 'progress' && showQaRejection ? (
        <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-3 space-y-3">
          <div className="text-xs font-medium text-danger">QA Rejection (required)</div>
          <Input
            placeholder="Root cause"
            value={qaRejection.root_cause}
            onChange={(e) => setQaRejection((prev) => ({ ...prev, root_cause: e.target.value }))}
            className="h-9 text-xs"
          />
          <Textarea
            placeholder="Repro steps"
            value={qaRejection.repro_steps}
            onChange={(e) => setQaRejection((prev) => ({ ...prev, repro_steps: e.target.value }))}
            className="min-h-[68px] text-xs"
          />
          <Input
            placeholder="Impacted files (comma-separated)"
            value={qaRejection.impacted_files}
            onChange={(e) => setQaRejection((prev) => ({ ...prev, impacted_files: e.target.value }))}
            className="h-9 text-xs"
          />
          <Input
            placeholder="Failed checks (comma-separated)"
            value={qaRejection.failed_checks}
            onChange={(e) => setQaRejection((prev) => ({ ...prev, failed_checks: e.target.value }))}
            className="h-9 text-xs"
          />
          <Textarea
            placeholder="Extra notes (optional)"
            value={qaRejection.extra_notes}
            onChange={(e) => setQaRejection((prev) => ({ ...prev, extra_notes: e.target.value }))}
            className="min-h-[56px] text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowQaRejection(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                isTransitioning ||
                !qaRejection.root_cause.trim() ||
                !qaRejection.repro_steps.trim() ||
                !qaRejection.impacted_files.trim() ||
                !qaRejection.failed_checks.trim()
              }
              onClick={() =>
                handleTransition('progress', {
                  comment_text: qaRejection.extra_notes.trim()
                    ? `QA REJECTED: Returned to progress. ${qaRejection.extra_notes.trim()}`
                    : 'QA REJECTED: Returned to progress.',
                  qa_rejection: {
                    root_cause: qaRejection.root_cause.trim(),
                    repro_steps: qaRejection.repro_steps.trim(),
                    impacted_files: qaRejection.impacted_files.trim(),
                    failed_checks: qaRejection.failed_checks
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  },
                })
              }
            >
              Reject to Progress
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Comment Item with entrance animation
function CommentItem({
  comment,
  index,
  developerName,
  animateEntry,
}: {
  comment: TaskComment
  index: number
  developerName: string
  animateEntry: boolean
}) {
  const isDeveloperComment = (comment.agent_name || '').trim().toLowerCase() === String(developerName || '').trim().toLowerCase()
  const parsedVicks = useMemo(() => {
    return isDeveloperComment ? parseVicksComment(comment.comment || '') : null
  }, [isDeveloperComment, comment.comment])

  return (
    <motion.div
      initial={animateEntry ? { opacity: 0, y: 10, scale: 0.98 } : undefined}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{
        delay: animateEntry ? Math.min(index, COMMENTS_PAGE_SIZE - 1) * 0.03 : 0,
        duration: 0.2,
        ease: 'easeOut',
      }}
      className="mx-1 flex gap-3 rounded-xl border border-border-default/60 bg-surface-default/30 p-3 sm:p-3.5"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-default flex items-center justify-center text-text-primary font-medium">
        {comment.agent_name?.[0] || '?'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-text-primary text-xs sm:text-sm">
            {comment.agent_name || 'Unknown'}
          </span>
          <span className="text-xs text-text-muted">
            {formatRelativeTime(comment.created_at)}
          </span>
        </div>

        {parsedVicks ? (
          <VicksCommentContent parsed={parsedVicks} />
        ) : (
          <MarkdownContent content={comment.comment} compact size="xs" />
        )}
      </div>
    </motion.div>
  )
}

// Comments Section with animated list
function CommentsSection({ taskId }: { taskId: string }) {
  const developerName = useAgentStore((state) => state.workflow.roles.developer)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [total, setTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [hasMore, setHasMore] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [animateFromIndex, setAnimateFromIndex] = useState(0)
  const commentsLengthRef = useRef(0)

  useEffect(() => {
    commentsLengthRef.current = comments.length
  }, [comments.length])

  const fetchCommentsPage = useCallback(async (offset: number, append: boolean) => {
    if (!taskId) return

    if (append) {
      setIsLoadingMore(true)
      setAnimateFromIndex(commentsLengthRef.current)
    } else {
      setIsInitialLoading(true)
      setAnimateFromIndex(0)
    }
    setLoadError(null)

    try {
      const page = await commentsApi.getByTask(taskId, {
        limit: COMMENTS_PAGE_SIZE,
        offset,
        order: 'desc',
      })

      setTotal(page.total)
      setHasMore(page.has_more)
      setNextOffset(page.next_offset)

      setComments((prev) => {
        const base = append ? prev : []
        const seen = new Set(base.map((item) => item.id))
        const merged = [...base]

        for (const item of page.comments) {
          if (seen.has(item.id)) continue
          merged.push(item)
          seen.add(item.id)
        }

        return merged
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load comments'
      setLoadError(message)
    } finally {
      if (append) {
        setIsLoadingMore(false)
      } else {
        setIsInitialLoading(false)
      }
    }
  }, [taskId])

  useEffect(() => {
    let active = true

    void commentsApi.getByTask(taskId, {
      limit: COMMENTS_PAGE_SIZE,
      offset: 0,
      order: 'desc',
    })
      .then((page) => {
        if (!active) return
        setTotal(page.total)
        setHasMore(page.has_more)
        setNextOffset(page.next_offset)
        setComments(page.comments)
        setLoadError(null)
      })
      .catch((error) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Failed to load comments'
        setLoadError(message)
      })
      .finally(() => {
        if (!active) return
        setIsInitialLoading(false)
      })

    return () => {
      active = false
    }
  }, [taskId])

  const retryFetch = useCallback(() => {
    const canAppend = comments.length > 0 && hasMore && nextOffset != null
    const targetOffset = canAppend ? nextOffset : 0
    void fetchCommentsPage(targetOffset, canAppend)
  }, [comments.length, hasMore, nextOffset, fetchCommentsPage])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!hasMore || isInitialLoading || isLoadingMore || nextOffset == null) return

    const target = event.target as HTMLDivElement
    const remainingPx = target.scrollHeight - target.scrollTop - target.clientHeight
    if (remainingPx <= 120) {
      void fetchCommentsPage(nextOffset, true)
    }
  }, [hasMore, isInitialLoading, isLoadingMore, nextOffset, fetchCommentsPage])

  return (
    <motion.div 
      className="flex min-h-[calc(95vh-330px)] sm:min-h-[calc(90vh-360px)] flex-col space-y-3 sm:space-y-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <motion.div 
        className="flex items-center gap-2"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5 }}
      >
        <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-text-muted" />
        <span className="font-medium text-text-primary text-xs sm:text-sm">Comments ({total})</span>
      </motion.div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1" onScroll={handleScroll}>
        <div className="space-y-2 p-1 sm:p-2">
          {isInitialLoading ? (
            <LoadingSpinner />
          ) : comments.length === 0 ? (
            <EmptyState
              title="No comments yet"
              description="Be the first to comment on this task"
            />
          ) : (
            comments.map((comment, index) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                index={index}
                developerName={developerName}
                animateEntry={index >= animateFromIndex}
              />
            ))
          )}

          {loadError ? (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
              {loadError}
              <button
                type="button"
                onClick={retryFetch}
                className="ml-2 underline"
              >
                Retry
              </button>
            </div>
          ) : null}

          {comments.length > 0 ? (
            <div className="pt-1 text-center text-[11px] text-text-muted">
              {hasMore ? (isLoadingMore ? 'Loading older comments...' : 'Scroll down for older comments') : 'You are seeing all comments'}
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  )
}

function QaEvidenceSection({ taskId }: { taskId: string }) {
  const [entries, setEntries] = useState<QaEvidenceEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [previewImage, setPreviewImage] = useState<QaPreviewImage | null>(null)

  useEffect(() => {
    let active = true
    void tasksApi.getQaEvidence(taskId)
      .then((result) => {
        if (!active) return
        setEntries(result)
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [taskId])

  return (
    <motion.section variants={itemVariants} className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs sm:text-sm font-medium text-text-muted">QA Evidence ({entries.length})</h3>
      </div>

      {isLoading ? (
        <LoadingSpinner size="sm" />
      ) : entries.length === 0 ? (
        <div className="text-xs text-text-muted">No QA evidence captured yet.</div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border-default/60 bg-surface-default/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={cn('font-medium', entry.payload.executed ? 'text-success' : 'text-warning')}>
                  {entry.payload.executed ? 'Executed' : 'Not executed'}
                </span>
                <span className="text-text-muted">{formatRelativeTime(entry.created_at)}</span>
              </div>

              {entry.payload.reason ? (
                <div className="text-xs text-text-secondary">{entry.payload.reason}</div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {entry.payload.screenshots.map((shot, index) => {
                  const src = tasksApi.getQaEvidenceScreenshotUrl(taskId, entry.id, index)
                  const alt = `QA evidence ${shot.viewport}`
                  return (
                    <button
                      key={`${entry.id}-${index}-${shot.path}`}
                      type="button"
                      onClick={() => setPreviewImage({ src, alt })}
                      className="group block rounded-md border border-border-default/60 bg-surface-default/40 p-2 text-left"
                    >
                      <img
                        src={src}
                        alt={alt}
                        className="h-28 w-full rounded object-cover bg-surface-default"
                        loading="lazy"
                      />
                      <div className="mt-1 text-[11px] text-text-muted line-clamp-2 group-hover:text-text-primary transition-colors">
                        {shot.viewport} - {shot.url}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => {
        if (!open) setPreviewImage(null)
      }}>
        <DialogContent aria-describedby={undefined} className="w-[96vw] max-w-5xl p-2 sm:p-4 bg-bg-card border-border-default">
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base text-text-primary">
              {previewImage?.alt || 'Screenshot preview'}
            </DialogTitle>
          </DialogHeader>
          {previewImage ? (
            <div className="max-h-[80vh] overflow-auto rounded-md bg-surface-default/40 p-1">
              <img
                src={previewImage.src}
                alt={previewImage.alt}
                className="w-full h-auto rounded object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </motion.section>
  )
}

// Subtasks Section with animations
function SubtasksSection({ task }: { task: Task }) {
  const context = useProjectStore((state) => state.taskContexts[task.id])
  const { openSubtaskModal } = useUIStore()
  const subtasks = context?.subtasks || []

  const handleSubtaskClick = (subtaskId: string) => {
    openSubtaskModal(subtaskId)
  }

  return (
    <motion.div 
      className="space-y-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <motion.div 
          className="flex items-center gap-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.35 }}
        >
          <CheckCircle2 className="h-4 w-4 text-text-muted" />
          <span className="font-medium text-text-primary">
            Subtasks ({subtasks.length})
          </span>
        </motion.div>

        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button variant="ghost" size="sm">
            + Add
          </Button>
        </motion.div>
      </div>

      {subtasks.length > 0 ? (
        <div className="space-y-2">
          {subtasks.map((subtask, index) => (
            <motion.div
              key={subtask.id}
              onClick={() => handleSubtaskClick(subtask.id)}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.4 + index * 0.1 }}
              whileHover={{ 
                scale: 1.02, 
                borderColor: "rgba(0, 217, 255, 0.3)",
                backgroundColor: "rgba(30, 41, 59, 0.8)"
              }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "p-3 rounded-lg border cursor-pointer",
                "border-border-default bg-surface-default/30",
                "transition-all duration-200"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-5 h-5 rounded border flex items-center justify-center",
                  subtask.status === 'done'
                    ? "bg-success border-success text-text-inverse"
                    : "border-text-muted"
                )}>
                  {subtask.status === 'done' ? <CheckCircle2 className="h-3 w-3" /> : null}
                </div>

                <span className={cn(
                  "flex-1 text-sm",
                  subtask.status === 'done' ? "line-through text-text-muted" : "text-text-primary"
                )}>
                  {subtask.title}
                </span>

                <StatusBadge status={subtask.status} showLabel={false} size="sm" />
              </div>
            </motion.div>
          ))}
        </div>
      ) : null}
    </motion.div>
  )
}

// Main Task Modal with enhanced transitions
export function TaskModal() {
  const isOpen = useUIStore((state) => state.modalStack.length > 0)
  const taskId = useUIStore((state) => {
    const currentModal = state.modalStack[state.modalStack.length - 1]
    return currentModal?.taskId
  })
  const modalType = useUIStore((state) => {
    const currentModal = state.modalStack[state.modalStack.length - 1]
    return currentModal?.type
  })
  const canGoBack = useUIStore((state) => state.canGoBack)
  const closeModal = useUIStore((state) => state.closeModal)
  const closeAllModals = useUIStore((state) => state.closeAllModals)
  const context = useProjectStore((state) => (taskId ? state.taskContexts[taskId] : undefined))
  const commentsRefreshToken = useProjectStore((state) => (taskId ? (state.taskCommentsVersion[taskId] || 0) : 0))
  const loadTaskContext = useProjectStore((state) => state.loadTaskContext)

  useEffect(() => {
    if (isOpen && taskId && !context) {
      void loadTaskContext(taskId)
    }
  }, [isOpen, taskId, loadTaskContext, context])

  const handleClose = () => {
    // If multiple modals are open, close only the current one (go back)
    // If only one is open, close all
    if (canGoBack()) {
      closeModal()
    } else {
      closeAllModals()
    }
  }

  const handleBack = () => {
    closeModal()
  }

  if (!isOpen || !taskId) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) handleClose()
    }}>
      <DialogContent aria-describedby={undefined} className="w-full max-w-full sm:max-w-lg tablet:max-w-2xl lg:max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden p-0 rounded-lg sm:rounded-xl">
        {/* Header with back navigation and close button */}
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:pb-0 border-b border-border-default sm:border-0">
          <AnimatePresence mode="wait">
            {canGoBack() && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="h-8 text-text-muted hover:text-text-primary group px-2"
                >
                  <motion.div
                    className="flex items-center"
                    whileHover={{ x: -3 }}
                    transition={{ type: "spring", stiffness: 400 }}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1 transition-transform group-hover:-translate-x-1" />
                    <span className="text-xs sm:text-sm">Back</span>
                  </motion.div>
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Close button visible on mobile */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8 sm:hidden ml-auto"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <AnimatePresence mode="wait">
          {!context ? (
            <motion.div 
              key="loading"
              className="flex items-center justify-center h-[300px] sm:h-[400px]"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
            >
              <LoadingSpinner size="lg" />
            </motion.div>
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <DialogHeader className="px-4 pb-0 pt-2 sm:px-6 sm:pt-4">
                <DialogTitle className="sr-only">Task details</DialogTitle>
                <TaskHeader task={context.task} project={context.project} />
              </DialogHeader>

              <ScrollArea className="flex-1 h-[calc(95vh-120px)] sm:h-[calc(90vh-140px)]">
                <motion.div 
                  className="p-4 sm:p-6 space-y-4 sm:space-y-6"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <div className="space-y-4 sm:space-y-6">
                    <motion.div variants={itemVariants}>
                      <TaskMetadata task={context.task} />
                    </motion.div>

                    <motion.section variants={itemVariants}>
                      <h3 className="text-xs sm:text-sm font-medium text-text-muted mb-2">Description</h3>
                      <TaskDescription description={context.task.description} />
                    </motion.section>

                    {modalType === 'task' && (
                      <section>
                        <SubtasksSection task={context.task} />
                      </section>
                    )}

                    <motion.section variants={itemVariants}>
                      <CommentsSection key={`${context.task.id}:${commentsRefreshToken}`} taskId={context.task.id} />
                    </motion.section>

                    <QaEvidenceSection taskId={context.task.id} />
                  </div>
                </motion.div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
