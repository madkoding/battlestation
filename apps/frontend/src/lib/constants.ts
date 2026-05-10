// Task Status
export type TaskStatus = 'todo' | 'progress' | 'qa' | 'done'

export const STATUSES: TaskStatus[] = ['todo', 'progress', 'qa', 'done']

export interface StatusMeta {
  label: string
  owner: string
  color: string
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  todo: { label: 'Todo', owner: 'Orchestrator', color: 'status-todo' },
  progress: { label: 'In Progress', owner: 'Developer', color: 'status-progress' },
  qa: { label: 'QA', owner: 'QA', color: 'status-qa' },
  done: { label: 'Done', owner: 'Orchestrator', color: 'status-done' },
}

export const STATUS_ICON: Record<TaskStatus, string> = {
  todo: '○',
  progress: '▶',
  qa: '?',
  done: '✓',
}

// Allowed transitions
export const ALLOWED_TRANSITIONS = new Set([
  'todo:progress',
  'progress:qa',
  'qa:progress',
  'qa:done',
])

export const TRANSITION_CONFIG: Record<string, { agent: string; comment: string }> = {
  'todo:progress': { 
    agent: '', 
    comment: 'Task prepared and ready for implementation.' 
  },
  'progress:qa': { 
    agent: '', 
    comment: 'Implementation complete. Ready for QA review.' 
  },
  'qa:progress': { 
    agent: '', 
    comment: 'QA REJECTED: Issues found during review.' 
  },
  'qa:done': {
    agent: '',
    comment: 'QA approved and human approval confirmed. Closing task.',
  },
}

// Priority
export type Priority = 'low' | 'medium' | 'high'

export const PRIORITIES: Priority[] = ['low', 'medium', 'high']

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Low', color: 'text-secondary' },
  medium: { label: 'Medium', color: 'warning' },
  high: { label: 'High', color: 'danger' },
}

// Themes
export type Theme = 'cyber-dark' | 'nightops' | 'studio' | 'cyan' | 'amber' | 'magenta' | 'terminal'

export const THEMES: Theme[] = [
  'cyber-dark',
  'nightops', 
  'studio', 
  'cyan', 
  'amber', 
  'magenta', 
  'terminal'
]

export const THEME_META: Record<Theme, { label: string; description: string }> = {
  'cyber-dark': { 
    label: 'Cyber Dark', 
    description: 'Neon cyan/magenta on deep black' 
  },
  'nightops': { 
    label: 'Night Ops', 
    description: 'Blue professional dark theme' 
  },
  'studio': { 
    label: 'Studio', 
    description: 'Clean light theme' 
  },
  'cyan': { 
    label: 'Cyan', 
    description: 'Neon cyan accent' 
  },
  'amber': { 
    label: 'Amber', 
    description: 'Retro amber CRT' 
  },
  'magenta': { 
    label: 'Magenta', 
    description: 'Purple synthwave' 
  },
  'terminal': { 
    label: 'Terminal', 
    description: 'Green hacker style' 
  },
}

// Activity types
export type ActivityType = 
  | 'thinking' 
  | 'reading' 
  | 'searching' 
  | 'writing' 
  | 'editing' 
  | 'testing' 
  | 'completed' 
  | 'blocked'

export const ACTIVITY_META: Record<ActivityType, { icon: string; label: string; color: string }> = {
  thinking: { icon: '💭', label: 'Thinking', color: 'accent-primary' },
  reading: { icon: '📖', label: 'Reading', color: 'text-secondary' },
  searching: { icon: '🔍', label: 'Searching', color: 'accent-secondary' },
  writing: { icon: '✍️', label: 'Writing', color: 'accent-tertiary' },
  editing: { icon: '✏️', label: 'Editing', color: 'accent-warning' },
  testing: { icon: '🧪', label: 'Testing', color: 'accent-success' },
  completed: { icon: '✅', label: 'Completed', color: 'accent-success' },
  blocked: { icon: '⛔', label: 'Blocked', color: 'accent-danger' },
}

// API/WS resolution
const runtimeOrigin =
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:18794'

const runtimeWsOrigin =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : 'ws://localhost:18794'

const isViteDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)

// By default use same-origin so frontend works behind host/IP/reverse-proxy.
export const API_BASE_URL = import.meta.env.VITE_API_URL || (isViteDev ? '' : runtimeOrigin)
export const WS_BASE_URL = import.meta.env.VITE_WS_URL || (isViteDev ? 'ws://localhost:18793' : runtimeWsOrigin)
