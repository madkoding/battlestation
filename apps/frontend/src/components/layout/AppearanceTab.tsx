import { THEMES, THEME_META, type Theme } from '@/lib/constants'
import { Check, Monitor, Palette, ScanLine } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function AppearanceTab({
  theme,
  setTheme,
  density,
  setDensity,
  densityMode,
  setDensityMode,
  crtFx,
  setCrtFx,
}: {
  theme: Theme
  setTheme: (t: Theme) => void
  density: 'normal' | 'compact'
  setDensity: (d: 'normal' | 'compact') => void
  densityMode: 'auto' | 'manual'
  setDensityMode: (m: 'auto' | 'manual') => void
  crtFx: 'on' | 'off'
  setCrtFx: (v: 'on' | 'off') => void
}) {
  return (
    <>
      {/* Theme Selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
          <Palette className="h-4 w-4" />
          Theme
        </label>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => (
            <Button
              key={t}
              variant={theme === t ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme(t)}
              className={cn(
                "justify-start gap-2",
                theme === t && "bg-accent-primary text-text-inverse"
              )}
            >
              {theme === t && <Check className="h-3 w-3" />}
              <span>{THEME_META[t].label}</span>
            </Button>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          {THEME_META[theme].description}
        </p>
      </div>

      {/* Density */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
          <Monitor className="h-4 w-4" />
          Density
        </label>
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-default/50">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{density === 'compact' ? 'Compact' : 'Normal'}</p>
            <p className="text-xs text-text-muted">
              {densityMode === 'auto' ? 'Auto-detected from screen size' : 'Manually set'}
            </p>
          </div>
          <Switch
            checked={density === 'compact'}
            onCheckedChange={(checked) => {
              setDensityMode('manual')
              setDensity(checked ? 'compact' : 'normal')
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={densityMode === 'auto'}
            onCheckedChange={(checked) =>
              setDensityMode(checked ? 'auto' : 'manual')
            }
          />
          <span className="text-xs text-text-secondary">Auto-detect</span>
        </div>
      </div>

      {/* CRT Effect */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
          <ScanLine className="h-4 w-4" />
          Effects
        </label>
        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-default/50">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">CRT Scanlines</p>
            <p className="text-xs text-text-muted">Retro monitor effect overlay</p>
          </div>
          <Switch
            checked={crtFx === 'on'}
            onCheckedChange={(checked) => setCrtFx(checked ? 'on' : 'off')}
          />
        </div>
      </div>
    </>
  )
}
