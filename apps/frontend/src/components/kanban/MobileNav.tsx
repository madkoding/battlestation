import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STATUSES, STATUS_META, type TaskStatus } from '@/lib/constants'
import type { Task } from '@/types/models'
import { cn } from '@/lib/utils'

interface MobileNavProps {
  currentColumnIndex: number
  goToColumn: (index: number) => void
  scrollToColumn: (direction: 'left' | 'right') => void
  tasksByStatus: Record<TaskStatus, Task[]>
}

function MobileNav({ currentColumnIndex, goToColumn, scrollToColumn, tasksByStatus }: MobileNavProps) {
  return (
    <>
      <div className="md:hidden flex flex-col border-b border-border-default">
        <div className="flex items-center justify-between px-2 py-1.5 sm:px-3 sm:py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrollToColumn('left')}
            disabled={currentColumnIndex === 0}
            className="h-8 w-8 sm:h-9 sm:w-9 text-text-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
          </Button>
          <div className="flex flex-col items-center">
            <span className="text-xs sm:text-sm font-medium text-text-primary">
              {STATUS_META[STATUSES[currentColumnIndex]].label}
            </span>
            <span className="text-[10px] text-text-muted">
              {tasksByStatus[STATUSES[currentColumnIndex]].length} tasks · {currentColumnIndex + 1}/{STATUSES.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrollToColumn('right')}
            disabled={currentColumnIndex === STATUSES.length - 1}
            className="h-8 w-8 sm:h-9 sm:w-9 text-text-muted disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
          </Button>
        </div>
        <div className="px-3 pb-1.5 text-[10px] text-text-muted text-center">
          Swipe or scroll horizontally to change column
        </div>

        {/* Progress indicator bar */}
        <div className="flex h-0.5 bg-surface-default">
          {STATUSES.map((_, index) => (
            <div
              key={index}
              className={cn(
                "flex-1 transition-colors duration-200",
                index === currentColumnIndex ? "bg-accent-primary" : "bg-transparent"
              )}
            />
          ))}
        </div>
      </div>

      {/* Mobile pagination dots */}
      <div className="md:hidden flex justify-center gap-2 py-2 sm:py-3 border-t border-border-default">
        {STATUSES.map((status, index) => (
          <button
            key={index}
            onClick={() => goToColumn(index)}
            className={cn(
              "h-2 sm:h-2.5 rounded-full transition-all duration-200",
              index === currentColumnIndex
                ? "w-6 sm:w-8 bg-accent-primary"
                : "w-2 sm:w-2.5 bg-text-muted/30 hover:bg-text-muted/50"
            )}
            aria-label={`Go to ${STATUS_META[status].label} column`}
          />
        ))}
      </div>
    </>
  )
}

export { MobileNav }
