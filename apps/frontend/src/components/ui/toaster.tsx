import { useToastStore } from '@/stores/toastStore'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'

export function Toaster() {
  const { toasts, removeToast } = useToastStore()

  return (
    <ToastProvider>
      {toasts.map(({ id, type, message }) => (
        <Toast key={id} variant={type === 'error' ? 'destructive' : type} onOpenChange={() => removeToast(id)}>
          <div className="grid gap-1">
            {type === 'error' && <ToastTitle>Error</ToastTitle>}
            {type === 'success' && <ToastTitle>Success</ToastTitle>}
            <ToastDescription>{message}</ToastDescription>
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
