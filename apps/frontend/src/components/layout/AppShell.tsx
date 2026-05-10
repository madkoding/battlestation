import { Toaster } from "@/components/ui/toaster"
import { Header } from "./Header"
import { ThemeProvider, SettingsPanel } from "./ThemeProvider"
import { useUIStore } from "@/stores/uiStore"
import { cn } from "@/lib/utils"

export function AppShell({ children }: { children: React.ReactNode }) {
  const { crtFx } = useUIStore()
  
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
        
        <Header />
        
        <main className="pt-16 min-h-screen">
          <div className="w-full mx-auto p-2 sm:p-3 tablet:p-4 lg:p-6">
            {children}
          </div>
        </main>
        
        <SettingsPanel />
        <Toaster />
      </div>
    </ThemeProvider>
  )
}
