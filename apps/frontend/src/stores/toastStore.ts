import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

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
          toasts: state.toasts.some((t) => t.type === type && t.message === message && createdAt - t.createdAt < 2500)
            ? state.toasts
            : [...state.toasts.slice(-5), toast] // Keep max 6 toasts
        }))
        
        // Auto-remove after 4.2 seconds
        setTimeout(() => {
          get().removeToast(id)
        }, 4200)
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
