import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { AgentBadge } from '@/components/common/StatusBadge'
import { useActivityStore } from '@/stores/activityStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { activityApi } from '@/lib/api'
import { useToastStore } from '@/stores/toastStore'
import { formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Activity } from '@/types/models'

function ActivityItem({ activity }: { activity: Activity }) {
  const activityType = (activity.type || '').toLowerCase()
  const readableStep = activity.currentTask || activity.message || 'Agent update'
  const agentLabel = activity.agentName || activity.agent || 'Unknown'
  const projectLabel = activity.projectName || activity.project_name || ''
  const taskLabel = activity.taskTitle || activity.task_title || ''

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-hover/50 transition-colors">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-default border border-border-default flex items-center justify-center text-[10px] uppercase text-text-muted">
        {(activityType || 'a').slice(0, 2)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <AgentBadge agent={agentLabel} showLabel size="sm" />
          <span className="text-[10px] uppercase tracking-wider text-accent-primary bg-accent-primary/10 border border-accent-primary/25 px-1.5 py-0.5 rounded">
            {activityType || 'activity'}
          </span>
          <span className="text-xs text-text-muted">{formatRelativeTime(activity.timestamp)}</span>
        </div>

        <p className="text-sm text-text-primary mt-1 line-clamp-2">{readableStep}</p>

        {(projectLabel || taskLabel) ? (
          <p className="text-xs text-text-muted mt-1 line-clamp-2">
            {projectLabel ? `${projectLabel}` : ''}
            {projectLabel && taskLabel ? ' - ' : ''}
            {taskLabel ? taskLabel : ''}
          </p>
        ) : null}

        {activity.message && activity.message !== readableStep ? (
          <p className="text-xs text-text-secondary/90 mt-1 line-clamp-2">{activity.message}</p>
        ) : null}
      </div>
    </div>
  )
}

function AgentPulse({ activities }: { activities: Activity[] }) {
  const [now, setNow] = useState(() => Date.now())
  const activeWindowMs = 90000
  const latestByAgent = new Map<string, Activity>()

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  for (const activity of activities) {
    const key = activity.agentName || activity.agent || 'Unknown'
    if (!latestByAgent.has(key)) {
      latestByAgent.set(key, activity)
    }
  }

  const rows = Array.from(latestByAgent.entries()).slice(0, 8)

  return (
    <div className="px-3 py-2 sm:px-4 border-b border-border-default bg-surface-default/30">
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2 hidden sm:block">Agents Pulse</div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map(([agent, activity]) => {
          const ts = Date.parse(activity.timestamp)
          const isFresh = Number.isFinite(ts) ? now - ts <= activeWindowMs : false
          return (
            <div
              key={`${agent}-${activity.timestamp}`}
              className="flex items-center justify-between rounded-md border border-border-default px-2 py-1.5 bg-bg-card/60"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn('h-2 w-2 rounded-full shrink-0', isFresh ? 'bg-success animate-pulse' : 'bg-text-muted')} />
                <span className="text-xs text-text-primary truncate">{agent}</span>
              </div>
              <span className="text-[11px] text-text-muted shrink-0">{isFresh ? 'active' : 'idle'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function LiveActivityModal() {
  const { isLiveActivityOpen, setLiveActivityOpen, modalStack } = useUIStore()
  const { activities } = useActivityStore()
  const { selectedProjectId } = useProjectStore()
  const addToast = useToastStore((state) => state.addToast)
  const [scopeRaw, setScopeRaw] = useState<'global' | 'project' | 'task'>('global')
  const [persistedScoped, setPersistedScoped] = useState<Activity[]>([])
  const [isLoadingScoped, setIsLoadingScoped] = useState(false)

  const activeTaskId = modalStack.length ? modalStack[modalStack.length - 1].taskId : null
  const canUseProjectScope = !!selectedProjectId
  const canUseTaskScope = !!activeTaskId

  const scope = useMemo<'global' | 'project' | 'task'>(() => {
    if (scopeRaw === 'task' && !canUseTaskScope) {
      return canUseProjectScope ? 'project' : 'global'
    }
    if (scopeRaw === 'project' && !canUseProjectScope) {
      return 'global'
    }
    return scopeRaw
  }, [scopeRaw, canUseProjectScope, canUseTaskScope])

  useEffect(() => {
    if (!isLiveActivityOpen) {
      return
    }

    const filters: { project_id?: string; task_id?: string } = {}
    if (scope === 'project' && selectedProjectId) {
      filters.project_id = selectedProjectId
    }
    if (scope === 'task' && activeTaskId) {
      filters.task_id = activeTaskId
    }

    const requestLoading = window.setTimeout(() => setIsLoadingScoped(true), 0)
    void activityApi.getLive(filters)
      .then((data) => {
        setPersistedScoped(data)
      })
      .finally(() => {
        setIsLoadingScoped(false)
      })
    return () => {
      window.clearTimeout(requestLoading)
    }
  }, [isLiveActivityOpen, scope, selectedProjectId, activeTaskId])

  const liveScoped = useMemo(() => {
    return activities.filter((entry) => {
      const entryProjectId = String(entry.project_id || entry.projectId || '').trim()
      const entryTaskId = String(entry.task_id || entry.taskId || '').trim()

      if (scope === 'project' && selectedProjectId) {
        return entryProjectId === selectedProjectId
      }
      if (scope === 'task' && activeTaskId) {
        return entryTaskId === activeTaskId
      }
      return true
    })
  }, [activities, scope, selectedProjectId, activeTaskId])

  const merged = useMemo(() => {
    const seen = new Set<string>()
    const rows: Activity[] = []

    const add = (activity: Activity) => {
      const key = activity.id || `${activity.agent || 'Unknown'}|${activity.message || ''}|${activity.timestamp}`
      if (seen.has(key)) return
      seen.add(key)
      rows.push(activity)
    }

    for (const item of liveScoped) add(item)
    for (const item of persistedScoped) add(item)

    return rows.slice(0, 20)
  }, [liveScoped, persistedScoped])

  const sorted = [...merged].sort((a, b) => {
    const aTs = Date.parse(a.timestamp)
    const bTs = Date.parse(b.timestamp)
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0)
  })

  const countsByType = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of sorted) {
      const key = String(row.type || 'activity').toLowerCase()
      map.set(key, (map.get(key) || 0) + 1)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  }, [sorted])

  const handleCopyDiagnostics = async () => {
    const top = sorted[0]
    const payload = {
      scope,
      selectedProjectId: selectedProjectId || null,
      activeTaskId: activeTaskId || null,
      total: sorted.length,
      countsByType: Object.fromEntries(countsByType),
      lastEvent: top
        ? {
            id: top.id || null,
            type: top.type || 'activity',
            agent: top.agent || top.agentName || 'Unknown',
            message: top.message || top.currentTask || '',
            timestamp: top.timestamp,
            project_id: top.project_id || top.projectId || null,
            task_id: top.task_id || top.taskId || null,
          }
        : null,
      generatedAt: new Date().toISOString(),
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      addToast('success', 'Live feed diagnostics copied')
    } catch {
      addToast('error', 'Could not copy diagnostics')
    }
  }

  return (
    <Dialog open={isLiveActivityOpen} onOpenChange={setLiveActivityOpen}>
      <DialogContent aria-describedby={undefined} className="max-w-[96vw] w-full sm:max-w-3xl h-[84vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border-default">
          <DialogTitle className="text-base sm:text-lg">
            Live Activity <span className="text-text-muted font-normal">({sorted.length})</span>
          </DialogTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={scope === 'global' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setScopeRaw('global')}
            >
              Global
            </Button>
            <Button
              type="button"
              size="sm"
              variant={scope === 'project' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              disabled={!canUseProjectScope}
              onClick={() => setScopeRaw('project')}
            >
              Current project
            </Button>
            <Button
              type="button"
              size="sm"
              variant={scope === 'task' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              disabled={!canUseTaskScope}
              onClick={() => setScopeRaw('task')}
            >
              Current task
            </Button>
            <span className="text-[11px] text-text-muted">
              {isLoadingScoped ? 'Refreshing history...' : 'Latest 20 persisted events'}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                void handleCopyDiagnostics()
              }}
            >
              Copy diagnostics
            </Button>
          </div>
          {countsByType.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {countsByType.map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center rounded border border-border-default bg-surface-default/50 px-2 py-0.5 text-[11px] text-text-secondary"
                >
                  {type}: {count}
                </span>
              ))}
            </div>
          ) : null}
        </DialogHeader>

        <AgentPulse activities={sorted} />

        <div className="flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-1">
              {sorted.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">No activity yet</div>
              ) : (
                sorted.slice(0, 100).map((activity) => (
                  <ActivityItem key={activity.id || `${activity.agent || 'Unknown'}-${activity.timestamp}`} activity={activity} />
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
