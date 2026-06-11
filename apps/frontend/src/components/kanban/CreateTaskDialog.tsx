import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CreateTaskDialogProps {
  isCreateModalOpen: boolean
  setIsCreateModalOpen: (v: boolean) => void
  newTaskTitle: string
  setNewTaskTitle: (v: string) => void
  newTaskDescription: string
  setNewTaskDescription: (v: string) => void
  newTaskPriority: 'low' | 'medium' | 'high'
  setNewTaskPriority: (v: 'low' | 'medium' | 'high') => void
  isCreatingTask: boolean
  handleCreateTaskSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>
  resetCreateTaskForm: () => void
}

function CreateTaskDialog({
  isCreateModalOpen,
  setIsCreateModalOpen,
  newTaskTitle,
  setNewTaskTitle,
  newTaskDescription,
  setNewTaskDescription,
  newTaskPriority,
  setNewTaskPriority,
  isCreatingTask,
  handleCreateTaskSubmit,
  resetCreateTaskForm,
}: CreateTaskDialogProps) {
  return (
    <Dialog
      open={isCreateModalOpen}
      onOpenChange={(open) => {
        setIsCreateModalOpen(open)
        if (!open) {
          resetCreateTaskForm()
        }
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">New Todo Task</DialogTitle>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleCreateTaskSubmit}>
          <Input
            value={newTaskTitle}
            onChange={(event) => setNewTaskTitle(event.target.value)}
            placeholder="Task title"
            autoFocus
            required
          />

          <Textarea
            value={newTaskDescription}
            onChange={(event) => setNewTaskDescription(event.target.value)}
            placeholder="Optional description"
            rows={3}
          />

          <Select
            value={newTaskPriority}
            onValueChange={(value) => setNewTaskPriority(value as 'low' | 'medium' | 'high')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low priority</SelectItem>
              <SelectItem value="medium">Medium priority</SelectItem>
              <SelectItem value="high">High priority</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsCreateModalOpen(false)
                resetCreateTaskForm()
              }}
              disabled={isCreatingTask}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreatingTask || !newTaskTitle.trim()}>
              {isCreatingTask ? 'Creating...' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { CreateTaskDialog }
