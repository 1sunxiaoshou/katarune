import type { ComponentProps } from "react";
import { TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SettingsSegmentedTabsList({
  options,
  className,
  ...props
}: Omit<ComponentProps<typeof TabsList>, "children"> & {
  readonly options: readonly { readonly value: string; readonly label: string }[];
}): React.JSX.Element {
  return (
    <TabsList
      {...props}
      className={`relative isolate grid h-8! rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground dark:bg-muted dark:text-muted-foreground ${className ?? ""}`}
    >
      <TabsIndicator className="model-category-indicator" />
      {options.map(({ value, label }) => (
        <TabsTrigger
          className="z-[1] w-full! min-w-0 justify-center! rounded-none px-1.5 text-[10px]! text-primary-foreground/70 hover:text-primary-foreground data-active:bg-transparent! data-active:text-foreground data-active:shadow-none! data-active:hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-active:border-transparent! dark:data-active:bg-transparent! dark:data-active:text-background dark:data-active:hover:text-background"
          key={value}
          value={value}
        >
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
