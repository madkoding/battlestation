import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores/uiStore'

export function useTheme() {
  const { theme, setTheme } = useUIStore()
  
  useEffect(() => {
    // Apply theme on mount
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  
  return { theme, setTheme }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  
  useEffect(() => {
    const media = window.matchMedia(query)
    
    const updateMatch = () => setMatches(media.matches)
    updateMatch()
    
    media.addEventListener('change', updateMatch)
    return () => media.removeEventListener('change', updateMatch)
  }, [query])
  
  return matches
}

export function useAutoDensity() {
  const { densityMode, setDensity } = useUIStore()
  const isCompact = useMediaQuery('(max-width: 768px)')
  
  useEffect(() => {
    if (densityMode === 'auto') {
      setDensity(isCompact ? 'compact' : 'normal')
    }
  }, [isCompact, densityMode, setDensity])
}
