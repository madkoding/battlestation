import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { TOAST_DEDUP_MS, TOAST_AUTO_REMOVE_MS, MAX_TOASTS } from '@/lib/constants'

interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  createdAt: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (type: Toast['type'], message: string) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>()(
  devtools(
    (set, get) => ({
      toasts: [],
      
      addToast: (type, message) => {
        const id = `${Date.now()}-${Math.random()}`
        const createdAt = Date.now()
        const toast = { id, type, message, createdAt }
        
        set((state) => ({
          toasts            : state.toasts.some((t) => t.type === type && t.message === message && createdAt - t.createdAt < TOAST_DEDUP_MS)
            ? state.toasts
            : [...state.toasts.slice(-MAX_TOASTS), toast]
        }))
        
        // Auto-remove after 4.2 seconds
        setTimeout(() => {
          get().removeToast(id)
        }, TOAST_AUTO_REMOVE_MS)
      },
      
      removeToast: (id) => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id)
        }))
      },
    }),
    { name: 'toast-store' }
  )
)
