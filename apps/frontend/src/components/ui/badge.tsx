import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-accent-primary text-text-inverse hover:bg-accent-primary/80",
        secondary:
          "border-transparent bg-accent-secondary text-text-inverse hover:bg-accent-secondary/80",
        destructive:
          "border-transparent bg-accent-danger text-text-inverse hover:bg-accent-danger/80",
        outline: "text-text-primary",
        success:
          "border-transparent bg-success text-text-inverse hover:bg-success/80",
        warning:
          "border-transparent bg-warning text-text-inverse hover:bg-warning/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge }
