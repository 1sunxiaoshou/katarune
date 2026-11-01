"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: Omit<SliderPrimitive.Root.Props<number>, "orientation" | "children">) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      thumbAlignment="edge"
      className={cn("relative min-w-0 touch-none select-none data-disabled:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Control data-slot="slider-control" className="relative flex h-8 w-full items-center">
        <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/8 dark:bg-foreground/10">
          <SliderPrimitive.Indicator data-slot="slider-indicator" className="h-full rounded-full bg-foreground/50 dark:bg-foreground/45" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className="size-3.5 rounded-full border border-foreground/10 bg-background shadow-sm outline-none transition-shadow duration-150 hover:shadow-md focus-within:ring-4 focus-within:ring-ring/15 data-disabled:pointer-events-none motion-reduce:transition-none dark:bg-foreground/80"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
