import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ChevronRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useProjectStore } from '@/stores/projectStore'
import { useToastStore } from '@/stores/toastStore'
import { tasksApi } from '@/lib/api'
import { STATUS_META, STATUSES, ALLOWED_TRANSITIONS, type TaskStatus } from '@/lib/constants'
import type { Task } from '@/types/models'

export function TaskStatusActions({ task }: { task: Task }) {
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
            {([
              ['scope_complete', 'Scope implementation complete'],
              ['self_review_done', 'Self-review completed'],
              ['tests_passed', 'Relevant tests passed'],
              ['diff_attached', 'Diff evidence attached'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                <span>{label}</span>
                <Switch
                  checked={Boolean(qaChecklist[key])}
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
