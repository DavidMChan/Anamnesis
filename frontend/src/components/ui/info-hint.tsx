import * as React from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InfoHintProps {
  children: React.ReactNode
  /** Which side the panel opens on. Defaults to 'right'. */
  side?: 'right' | 'top'
  className?: string
}

/**
 * Small "(i)" affordance that reveals an explanation on hover / focus / click.
 *
 * Deliberately dependency-free (no Radix): the panel is plain absolutely
 * positioned markup. Content is rendered inside a <span>, so callers should
 * use <span className="block"> rather than <p> for paragraphs.
 */
export function InfoHint({ children, side = 'right', className }: InfoHintProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <span className={cn('relative inline-flex items-center align-middle', className)}>
      <button
        type="button"
        aria-label="More information"
        aria-expanded={open}
        className="text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault()
          setOpen((v) => !v)
        }}
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-50 w-80 space-y-1.5 rounded-md border bg-popover p-3',
            'text-xs font-normal leading-relaxed text-popover-foreground shadow-lg',
            side === 'right'
              ? 'left-6 top-1/2 -translate-y-1/2'
              : 'bottom-6 left-1/2 -translate-x-1/2',
          )}
        >
          {children}
        </span>
      )}
    </span>
  )
}
