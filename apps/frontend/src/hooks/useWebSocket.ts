import { useEffect, useRef, useState, useCallback } from 'react'
import { API_BASE_URL, WS_BASE_URL } from '@/lib/constants'
import { useActivityStore } from '@/stores/activityStore'
import { useProjectStore } from '@/stores/projectStore'
import { useToastStore } from '@/stores/toastStore'
import { useUIStore } from '@/stores/uiStore'
import { activityApi } from '@/lib/api'
import type { Activity } from '@/types/models'

function normalizeActivity(payload: Activity): Activity {
  const anyPayload = payload as unknown as Record<string, unknown>
  const agent = String(anyPayload.agent ?? anyPayload.agentName ?? anyPayload.agentId ?? 'Unknown')

  return {
    ...payload,
    agent,
    agentId: String(anyPayload.agentId ?? ''),
    agentName: String(anyPayload.agentName ?? agent),
    currentTask: String(anyPayload.currentTask ?? anyPayload.message ?? ''),
    message: String(anyPayload.message ?? anyPayload.currentTask ?? ''),
    projectId: String(anyPayload.projectId ?? anyPayload.project_id ?? ''),
    project_id: String(anyPayload.project_id ?? anyPayload.projectId ?? ''),
    projectName: String(anyPayload.projectName ?? anyPayload.project_name ?? ''),
    project_name: String(anyPayload.project_name ?? anyPayload.projectName ?? ''),
    taskId: String(anyPayload.taskId ?? anyPayload.task_id ?? ''),
    task_id: String(anyPayload.task_id ?? anyPayload.taskId ?? ''),
    taskTitle: String(anyPayload.taskTitle ?? anyPayload.task_title ?? ''),
    task_title: String(anyPayload.task_title ?? anyPayload.taskTitle ?? ''),
    status: String(anyPayload.status ?? ''),
    mood: String(anyPayload.mood ?? ''),
    timestamp: String(anyPayload.timestamp ?? new Date().toISOString()),
  }
}

function isHeartbeatActivity(activity: Activity): boolean {
  return String(activity.type || '').toLowerCase() === 'heartbeat'
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectEnabledRef = useRef(true)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedHistoryRef = useRef(false)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting')
  const lastActivityToastRef = useRef<{ message: string; at: number } | null>(null)
  const addActivity = useActivityStore((state) => state.addActivity)
  const setActivities = useActivityStore((state) => state.setActivities)
  const refreshProject = useProjectStore((state) => state.refreshProject)
  const refreshTaskById = useProjectStore((state) => state.refreshTaskById)
  const bumpTaskCommentsVersion = useProjectStore((state) => state.bumpTaskCommentsVersion)
  const loadProjects = useProjectStore((state) => state.loadProjects)
  const addToast = useToastStore((state) => state.addToast)
  const setWsConnectionState = useUIStore((state) => state.setWsConnectionState)
  const setWsLastError = useUIStore((state) => state.setWsLastError)
  const setWsLastConnectedAt = useUIStore((state) => state.setWsLastConnectedAt)

  const handleMessage = useCallback((message: { type: string; payload: unknown }) => {
    switch (message.type) {
      case 'activity': {
        const activity = normalizeActivity(message.payload as Activity)
        if (isHeartbeatActivity(activity)) {
          break
        }
        addActivity(activity)
        const msg = String(activity.message || activity.currentTask || '').trim()
        const now = Date.now()
        const last = lastActivityToastRef.current
        const shouldToast = msg.length > 0 && (!last || last.message !== msg || now - last.at > 4000)
        if (shouldToast) {
          addToast('info', `Live: ${msg}`)
          lastActivityToastRef.current = { message: msg, at: now }
        }
        break
      }

      case 'task:updated':
      case 'task:created': {
        const payload = message.payload as {
          project_id?: string
          projectId?: string
          task_id?: string
          taskId?: string
          task_id_alt?: string
          id?: string
        }
        const taskId = String(payload.task_id ?? payload.taskId ?? payload.id ?? '')

        if (taskId) {
          void refreshTaskById(taskId, { includeContext: false })
        }
        break
      }

      case 'task:comment_created': {
        const payload = message.payload as {
          task_id?: string
          taskId?: string
          id?: string
        }
        const taskId = String(payload.task_id ?? payload.taskId ?? payload.id ?? '')
        if (taskId) {
          bumpTaskCommentsVersion(taskId)
          void refreshTaskById(taskId, { includeContext: false })
        }
        break
      }

      case 'project_status':
        loadProjects()
        break

      case 'task:deleted': {
        const payload = message.payload as { project_id: string }
        if (payload.project_id) {
          refreshProject(payload.project_id)
          addToast('info', 'Task deleted')
        }
        break
      }

      case 'qa:ready_for_approval': {
        addToast('success', 'QA is ready for human approval')
        break
      }

      case 'qa:approval_confirmed': {
        addToast('success', 'Human approval confirmed')
        break
      }

      default:
        console.log('Unhandled WebSocket message:', message)
    }
  }, [addActivity, refreshTaskById, bumpTaskCommentsVersion, loadProjects, addToast, refreshProject])
  
  const connect = useCallback(() => {
    const wsUrl = WS_BASE_URL.startsWith('ws://') || WS_BASE_URL.startsWith('wss://')
      ? WS_BASE_URL
      : `${WS_BASE_URL}/ws`

    const resolveHealthUrl = (): string | null => {
      try {
        const apiBase = String(API_BASE_URL || '').trim()
        if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
          return `${apiBase.replace(/\/$/, '')}/health`
        }
        if (typeof window !== 'undefined') {
          return `${window.location.origin}/health`
        }
      } catch {
        // fall through
      }
      return null
    }

    const healthUrl = resolveHealthUrl()

    const tryConnect = async () => {
        if (healthUrl) {
          try {
            const health = await fetch(healthUrl)
            if (!health.ok) {
              throw new Error('Backend not ready')
            }
          } catch {
            setWsLastError('Backend health check failed')
            if (!reconnectEnabledRef.current) return
          reconnectAttemptsRef.current += 1
          const retryAfterMs = Math.min(30000, 1000 * Math.pow(2, Math.max(0, reconnectAttemptsRef.current - 1)))
          reconnectTimerRef.current = setTimeout(() => {
            if (!reconnectEnabledRef.current) return
            void tryConnect()
          }, retryAfterMs)
          return
        }
      }
    
      try {
        setConnectionState(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting')
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
      
        ws.onopen = () => {
          console.log('WebSocket connected')
          const recovered = reconnectAttemptsRef.current > 0
          reconnectAttemptsRef.current = 0
          setIsConnected(true)
          setConnectionState('connected')
          setWsConnectionState('connected')
          setWsLastError(null)
          setWsLastConnectedAt(new Date().toISOString())

          if (!loadedHistoryRef.current) {
            void activityApi.getLive()
              .then((history) => {
                const normalized = history
                  .map((entry) => normalizeActivity(entry))
                  .filter((entry) => !isHeartbeatActivity(entry))
                setActivities(normalized)
                loadedHistoryRef.current = true
              })
              .catch(() => {
                // ignore history boot errors; realtime stream still works
              })
          }

          if (recovered) {
            addToast('success', 'Live updates connection restored')
          } else {
            addToast('info', 'Connected to live updates')
          }
        }
      
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            handleMessage(message)
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error)
          }
        }
      
        ws.onclose = () => {
          if (!reconnectEnabledRef.current) return
          console.log('WebSocket disconnected')
          setIsConnected(false)
          setConnectionState('reconnecting')
          setWsConnectionState('reconnecting')

          reconnectAttemptsRef.current += 1
          const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.max(0, reconnectAttemptsRef.current - 1)))
          const jitterMs = Math.floor(Math.random() * 400)
          const retryAfterMs = backoffMs + jitterMs

          if (reconnectAttemptsRef.current === 1) {
            addToast('error', 'Live updates disconnected, retrying...')
          }
          setWsLastError('WebSocket disconnected')

        // Attempt reconnect with exponential backoff + jitter
          reconnectTimerRef.current = setTimeout(() => {
            if (!reconnectEnabledRef.current) return
            if (wsRef.current?.readyState === WebSocket.CLOSED) {
              void tryConnect()
            }
          }, retryAfterMs)

          if (reconnectAttemptsRef.current >= 8) {
            setConnectionState('offline')
            setWsConnectionState('offline')
          }
        }
      
        ws.onerror = () => {
          if (!reconnectEnabledRef.current) return
          setIsConnected(false)
          setWsLastError('WebSocket error')
        }
      } catch {
        if (!reconnectEnabledRef.current) return
        setIsConnected(false)
        setWsLastError('Failed to initialize WebSocket')
      }
    }

    void tryConnect()
  }, [addToast, handleMessage, setActivities, setWsConnectionState, setWsLastConnectedAt, setWsLastError])
  
  useEffect(() => {
    reconnectEnabledRef.current = true
    reconnectAttemptsRef.current = 0
    setWsConnectionState('connecting')
    connect()
    
    return () => {
      reconnectEnabledRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      wsRef.current?.close()
    }
  }, [connect, setWsConnectionState])
  
  return { isConnected, connectionState }
}
