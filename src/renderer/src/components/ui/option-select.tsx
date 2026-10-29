import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "./button";
import { Command, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export function OptionSelect<T extends string | number>({
  id, label, value, options, disabled = false, title, onValueChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  title?: string;
  onValueChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger
      id={id}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? `${id}-options` : undefined}
      disabled={disabled}
      title={title}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
        }
      }}
      render={<Button variant="outline" className="w-full min-w-0 justify-between font-normal" />}
    >
      <span className="truncate">{options.find(option => option.value === value)?.label}</span>
      <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverContent align="end" matchTriggerWidth className="p-0">
      <Command defaultValue={String(value)} shouldFilter={false} loop>
        <div className="sr-only"><CommandInput readOnly aria-label={`${label}选项`} /></div>
        <CommandList id={`${id}-options`} aria-label={label}>
          {options.map(option => <CommandItem
            key={option.value}
            value={String(option.value)}
            data-testid={`${id}-option-${option.value}`}
            data-checked={option.value === value}
            disabled={disabled}
            onSelect={() => { onValueChange(option.value); setOpen(false); }}
          >{option.label}</CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
