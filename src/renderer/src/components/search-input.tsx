import type { ComponentProps } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({ className, ...props }: ComponentProps<typeof Input>): React.JSX.Element {
  return <div className="relative min-w-0 flex-1">
    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input {...props} className={cn("rounded-full pl-8", className)} />
  </div>;
}
