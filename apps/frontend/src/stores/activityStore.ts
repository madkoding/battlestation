import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { Activity } from '@/types/models'

interface ActivityState {
  activities: Activity[]
  isCollapsed: boolean
  userToggled: boolean
  
  addActivity: (activity: Activity) => void
  setActivities: (activities: Activity[]) => void
  addActivities: (activities: Activity[]) => void
  setCollapsed: (collapsed: boolean) => void
  setUserToggled: (toggled: boolean) => void
  clearActivities: () => void
}

export const useActivityStore = create<ActivityState>()(
  devtools(
    persist(
      (set) => ({
        activities: [],
        isCollapsed: false,
        userToggled: false,
        
        addActivity: (activity) => 
          set((state) => ({
            activities: [activity, ...state.activities].slice(0, 20) // Keep last 20
          })),

        setActivities: (activities) =>
          set(() => ({
            activities: activities.slice(0, 20),
          })),
        
        addActivities: (newActivities) => 
          set((state) => ({
            activities: [...newActivities, ...state.activities].slice(0, 20)
          })),
        
        setCollapsed: (isCollapsed) => set({ isCollapsed }),
        setUserToggled: (userToggled) => set({ userToggled }),
        clearActivities: () => set({ activities: [] }),
      }),
      {
        name: 'activity-store',
        partialize: (state) => ({ isCollapsed: state.isCollapsed, userToggled: state.userToggled })
      }
    ),
    { name: 'activity-store' }
  )
)
