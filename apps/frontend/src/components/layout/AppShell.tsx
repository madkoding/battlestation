import { lazy, Suspense } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { WifiOff } from "lucide-react"
import { Toaster } from "@/components/ui/toaster"
import { Header } from "./Header"
import { ThemeProvider } from "./ThemeProvider"
import { useUIStore } from "@/stores/uiStore"
import { cn } from "@/lib/utils"

const SettingsPanel = lazy(() =>
  import("./SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
)

export function AppShell({ children }: { children: React.ReactNode }) {
  const { crtFx, wsConnectionState } = useUIStore()
  
  return (
    <ThemeProvider>
      <div className={cn(
        "min-h-screen bg-bg-primary",
        crtFx === 'on' && "relative overflow-hidden"
      )}>
        {/* CRT Effect Overlay */}
        {crtFx === 'on' && (
          <div 
            className="fixed inset-0 pointer-events-none z-[100]"
            style={{
              background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%)',
              backgroundSize: '100% 4px',
            }}
          />
        )}

        <AnimatePresence>
          {wsConnectionState === 'offline' && (
            <motion.div
              initial={{ y: -32, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -32, opacity: 0 }}
              className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-danger/90 px-3 py-1.5 text-xs text-text-inverse"
            >
              <WifiOff className="h-3.5 w-3.5" />
              <span>No connection — retrying automatically</span>
            </motion.div>
          )}
        </AnimatePresence>
        
        <Header />
        
        <main className="pt-16 min-h-screen">
          <div className="w-full mx-auto p-2 sm:p-3 tablet:p-4 lg:p-6">
            {children}
          </div>
        </main>
        
        <Suspense fallback={null}>
          <SettingsPanel />
        </Suspense>
        <Toaster />
      </div>
    </ThemeProvider>
  )
}
