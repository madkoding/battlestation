import { motion, AnimatePresence } from 'framer-motion'
import { 
  Zap, 
  Search, 
  Settings, 
  X,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { ConnectionStatusPopover } from '@/components/common/ConnectionStatusPopover'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export function Header() {
  const {
    setSettingsOpen,
    dashboardQuery,
    setDashboardQuery,
    modalStack,
    closeModal,
    closeAllModals,
    setLiveActivityOpen,
  } = useUIStore()
  const { selectedProjectId, setSelectedProject } = useProjectStore()
  const [showMobileSearch, setShowMobileSearch] = useState(false)

  const isInProject = !!selectedProjectId
  const hasModalOpen = modalStack.length > 0

  return (
    <>
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className={cn(
          "fixed top-0 left-0 right-0 z-50 h-14 sm:h-16 glass-strong border-b border-border-default",
          "flex items-center justify-between px-2 sm:px-3 tablet:px-4 lg:px-6"
        )}
      >
        {/* Left Section */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Back Button - when in project or modal open */}
          {(isInProject || hasModalOpen) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (hasModalOpen) {
                  closeModal()
                } else {
                  setSelectedProject(null)
                  closeAllModals()
                }
              }}
              className="h-8 w-8 sm:h-9 sm:w-9"
            >
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          )}
          
          {/* Logo */}
          <motion.div 
            className="flex items-center gap-1.5 sm:gap-2"
            whileHover={{ scale: 1.02 }}
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-accent-primary flex items-center justify-center shadow-glow">
              <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-text-inverse" />
            </div>
            <div className="hidden xs:block">
              <h1 className="font-pixel text-[10px] sm:text-xs text-text-primary tracking-tight">
                BattleStation
              </h1>
              <p className="text-[8px] sm:text-[10px] text-text-muted -mt-0.5 sm:-mt-1 max-w-[130px] sm:max-w-none truncate">
                Multi-agent task orchestration platform
              </p>
            </div>
          </motion.div>
        </div>
        
        {/* Center Section - Search (hidden on mobile, visible on tablet+) */}
        <div className="flex-1 max-w-md mx-2 hidden tablet:block">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <Input
              type="text"
              placeholder="Search projects and tasks..."
              value={dashboardQuery}
              onChange={(e) => setDashboardQuery(e.target.value)}
              className="pl-10 bg-bg-secondary/50 border-border-default focus:border-accent-primary h-9 sm:h-10"
            />
          </div>
        </div>
        
        {/* Right Section */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Mobile Search Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMobileSearch(true)}
            className="tablet:hidden h-8 w-8 sm:h-9 sm:w-9"
          >
            <Search className="h-4 w-4 sm:h-5 sm:w-5 text-text-secondary hover:text-text-primary transition-colors" />
          </Button>
          
          {/* Activity Indicator */}
          <ConnectionStatusPopover onOpenActivity={() => setLiveActivityOpen(true)} />

          {/* Settings Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            className="h-8 w-8 sm:h-9 sm:w-9 relative"
          >
            <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-text-secondary hover:text-text-primary transition-colors" />
          </Button>
        </div>
      </motion.header>

      {/* Mobile Search Overlay */}
      <AnimatePresence>
        {showMobileSearch && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-x-0 top-14 z-40 bg-bg-secondary border-b border-border-default p-2 tablet:hidden"
          >
            <div className="relative flex items-center gap-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
              <Input
                type="text"
                placeholder="Search projects and tasks..."
                value={dashboardQuery}
                onChange={(e) => setDashboardQuery(e.target.value)}
                className="flex-1 pl-10 bg-bg-primary border-border-default focus:border-accent-primary"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowMobileSearch(false)}
                className="h-9 w-9 shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
