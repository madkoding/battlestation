import { FolderOpen, CheckCircle2, RotateCw, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatsOverviewProps {
  projectCount: number
  metrics: Record<string, number> | null
  isLoading: boolean
}

export function StatsOverview({
  projectCount,
  metrics,
  isLoading,
}: StatsOverviewProps) {
  const safeMetrics = metrics || {}

  const stats = [
    { label: 'Projects', value: projectCount, icon: FolderOpen, color: 'text-accent-primary' },
    { label: 'Todo', value: Number(safeMetrics.todo || 0), icon: CheckCircle2, color: 'text-text-muted' },
    { label: 'Progress', value: Number(safeMetrics.progress || 0), icon: RotateCw, color: 'text-status-progress' },
    { label: 'QA', value: Number(safeMetrics.qa || 0), icon: CheckCircle2, color: 'text-status-qa' },
    { label: 'Escalations', value: Number(safeMetrics.escalations || 0), icon: AlertTriangle, color: 'text-warning' },
    { label: 'Requeues', value: Number(safeMetrics.requeues || 0), icon: RotateCw, color: 'text-accent-secondary' },
  ]

  return (
    <div className="grid grid-cols-2 tablet:grid-cols-3 gap-2 sm:gap-3 tablet:gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="p-2.5 sm:p-3 tablet:p-4 border-border-default">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={cn("p-1.5 sm:p-2 rounded-lg bg-surface-default shrink-0", stat.color)}>
              <stat.icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-xl tablet:text-2xl font-bold text-text-primary">
                {isLoading ? '...' : stat.value}
              </p>
              <p className="text-[10px] sm:text-xs text-text-muted">{stat.label}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
