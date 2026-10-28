import { useLayoutEffect, useState } from "react";
import type { AvatarCapabilities } from "../../../shared/avatar";
import {
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorRoot,
  ModelSelectorTrigger,
} from "@/components/model-selector";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";

const groups = [
  { kind: "oneShot", label: "单次" },
  { kind: "loop", label: "循环" },
  { kind: "performance", label: "演出" },
] as const;
type ActionKind = typeof groups[number]["kind"];

export function ActionMenu({ actions, value, playingIds, active, onChange, onStop }: {
  actions: AvatarCapabilities["actions"];
  value: string;
  playingIds?: string[] | undefined;
  active: boolean;
  onChange: (value: string) => void;
  onStop: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ActionKind>("oneShot");
  const playing = new Set(playingIds ?? (value === "none" ? [] : [value]));
  const selected = actions.find(action => action.id === value && playing.has(action.id)) ?? actions.find(action => playing.has(action.id));
  const options = [...actions].sort((a, b) => Number(!!a.idle) - Number(!!b.idle))
    .map(action => ({ id: action.id, name: action.label }));
  const visibleIds = new Set(actions.filter(action => (action.kind ?? "oneShot") === kind).map(action => action.id));
  useLayoutEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  useLayoutEffect(() => {
    if (open && selected) setKind(selected.kind ?? "oneShot");
  }, [open, selected?.id, selected?.kind]);
  return (
    <ModelSelectorRoot
      models={options}
      value={selected?.id ?? ""}
      open={active && open}
      onOpenChange={next => {
        if (next && selected) setKind(selected.kind ?? "oneShot");
        setOpen(active && next);
      }}
    >
      <ModelSelectorTrigger className="desktop-choice-trigger" aria-label="动作" disabled={!actions.length}>
        {selected ? undefined : <span className="font-medium">自动待机</span>}
      </ModelSelectorTrigger>
      {active && (
        <ModelSelectorContent align="end" searchable={false} className="desktop-choice-content desktop-action-content">
          <Tabs value={kind} onValueChange={next => {
            const group = groups.find(group => group.kind === next);
            if (group) setKind(group.kind);
          }} className="desktop-action-filters">
            <TabsList className="desktop-tabs-list desktop-action-filter-list" aria-label="动作类型">
              <TabsIndicator className="desktop-tabs-indicator" />
              {groups.map(group => (
                <TabsTrigger key={group.kind} value={group.kind}>{group.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ModelSelectorList key={kind}>
            <ModelSelectorEmpty>暂无此类动作</ModelSelectorEmpty>
            <ModelSelectorGroup>
              {options.filter(option => visibleIds.has(option.id)).map(option => (
                <ModelSelectorItem
                  key={option.id}
                  model={option}
                  selected={playing.has(option.id)}
                  data-playing={playing.has(option.id)}
                  onSelect={() => playing.has(option.id) ? onStop(option.id) : onChange(option.id)}
                  className="data-[playing=true]:bg-muted data-[playing=true]:text-foreground"
                />
              ))}
            </ModelSelectorGroup>
          </ModelSelectorList>
        </ModelSelectorContent>
      )}
    </ModelSelectorRoot>
  );
}
