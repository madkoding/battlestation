import { cn } from "@/lib/utils"
import { useAgentStore } from '@/stores/agentStore'

interface StatusBadgeProps {
  status: 'todo' | 'progress' | 'qa' | 'done'
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const STATUS_CONFIG = {
  todo: {
    label: 'Todo',
    bg: 'bg-status-todo/20',
    text: 'text-status-todo',
    border: 'border-status-todo/30',
    dot: 'bg-status-todo',
  },
  progress: {
    label: 'In Progress',
    bg: 'bg-status-progress/20',
    text: 'text-status-progress',
    border: 'border-status-progress/30',
    dot: 'bg-status-progress',
  },
  qa: {
    label: 'QA',
    bg: 'bg-status-qa/20',
    text: 'text-status-qa',
    border: 'border-status-qa/30',
    dot: 'bg-status-qa',
  },
  done: {
    label: 'Done',
    bg: 'bg-status-done/20',
    text: 'text-status-done',
    border: 'border-status-done/30',
    dot: 'bg-status-done',
  },
}

const SIZE_CONFIG = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
  lg: 'px-4 py-1.5 text-base',
}

export function StatusBadge({ status, showLabel = true, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium transition-all',
        config.bg,
        config.text,
        config.border,
        SIZE_CONFIG[size]
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
      {showLabel && <span>{config.label}</span>}
    </span>
  )
}

interface PriorityBadgeProps {
  priority: 'low' | 'medium' | 'high'
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const PRIORITY_CONFIG = {
  low: {
    label: 'Low',
    bg: 'bg-text-muted/20',
    text: 'text-text-muted',
    border: 'border-text-muted/30',
  },
  medium: {
    label: 'Medium',
    bg: 'bg-warning/20',
    text: 'text-warning',
    border: 'border-warning/30',
  },
  high: {
    label: 'High',
    bg: 'bg-danger/20',
    text: 'text-danger',
    border: 'border-danger/30',
  },
}

export function PriorityBadge({ priority, showLabel = true, size = 'sm' }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority]
  
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium uppercase tracking-wider',
        config.bg,
        config.text,
        config.border,
        SIZE_CONFIG[size]
      )}
    >
      {showLabel && <span>{config.label}</span>}
    </span>
  )
}

interface AgentBadgeProps {
  agent: string
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const AGENT_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  Battlestation: { label: 'Battlestation', color: 'text-accent-primary', icon: '◈' },
  Vicks: { label: 'Vicks', color: 'text-status-progress', icon: '⚡' },
  Wedge: { label: 'Wedge', color: 'text-status-qa', icon: '🔍' },
}

export function AgentBadge({ agent, showLabel = true, size = 'sm' }: AgentBadgeProps) {
  const getAgentRole = useAgentStore((state) => state.getAgentRole)
  const role = getAgentRole(agent).toLowerCase()
  const dynamicConfig = role.includes('orchestrator')
    ? { label: agent, color: 'text-accent-primary', icon: '◈' }
    : role.includes('qa')
      ? { label: agent, color: 'text-status-qa', icon: '🔍' }
      : role.includes('developer') || role.includes('engineer')
        ? { label: agent, color: 'text-status-progress', icon: '⚡' }
        : null
  const config = dynamicConfig || AGENT_CONFIG[agent] || { label: agent, color: 'text-text-secondary', icon: '●' }
  
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium',
        config.color,
        SIZE_CONFIG[size]
      )}
    >
      <span className="opacity-80">{config.icon}</span>
      {showLabel && <span>{config.label}</span>}
    </span>
  )
}
