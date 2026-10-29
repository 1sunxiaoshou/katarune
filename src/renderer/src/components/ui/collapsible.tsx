import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ className, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn("group/collapsible-trigger", className)}
      {...props}
    />
  )
}

function CollapsibleIndicator({ className, ...props }: React.ComponentProps<typeof ChevronDownIcon>) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      data-slot="collapsible-indicator"
      className={cn("size-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[panel-open]/collapsible-trigger:rotate-180", className)}
      {...props}
    />
  )
}

function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn("overflow-hidden duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-open:animate-collapsible-down data-closed:animate-collapsible-up data-closed:fill-mode-forwards data-closed:pointer-events-none", className)}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleIndicator, CollapsibleContent }
