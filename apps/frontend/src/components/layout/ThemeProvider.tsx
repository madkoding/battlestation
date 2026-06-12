import { useEffect } from 'react'
import { useTheme, useAutoDensity } from '@/hooks/useTheme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useAutoDensity()

  return <>{children}</>
}
