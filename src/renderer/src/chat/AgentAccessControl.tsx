import { useEffect, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { CheckIcon, ChevronDownIcon, ShieldAlertIcon, ShieldIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import type { AgentAccessMode, AgentAccessState } from "../../../shared/agentTools";

const modes = [
  { value: "request-approval", label: "请求批准", description: "编辑外部文件和使用互联网时始终询问", icon: ShieldIcon },
  { value: "full-access", label: "完全访问权限", description: "可不受限制地访问互联网和你电脑上的任何文件", icon: ShieldAlertIcon },
] as const;

export function AgentAccessControl() {
  const { activeCharacter } = useCharacterSession();
  const aui = useAui();
  const localId = useAuiState(s => s.threadListItem.id);
  const threadId = useAuiState(s => s.threadListItem.remoteId);
  return <AccessMenu key={`${activeCharacter.id}:${localId}`} characterId={activeCharacter.id} threadId={threadId}
    initializeThread={async () => (await aui.threadListItem().initialize()).remoteId} />;
}

function AccessMenu({ characterId, threadId, initializeThread }: { characterId: string; threadId: string | undefined; initializeThread: () => Promise<string> }) {
  const [state, setState] = useState<AgentAccessState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.katarune.getAgentAccess({ characterId, threadId }).then(value => { if (active) setState(value); })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "无法读取工具权限。"); });
    return () => { active = false; };
  }, [characterId, threadId]);
  const perform = async (action: () => Promise<AgentAccessState | void>, close = false) => {
    setBusy(true); setError(null);
    try { const value = await action(); if (value) setState(value); if (close) setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : "无法更新工具权限。"); }
    finally { setBusy(false); }
  };
  const selectMode = (mode: AgentAccessMode) => {
    if (state?.mode === mode) { setOpen(false); return; }
    void perform(async () => window.katarune.setAgentAccessMode({ characterId, threadId: threadId ?? await initializeThread(), mode }), true);
  };
  const full = state?.mode === "full-access";
  return <Popover open={open} onOpenChange={next => {
    setOpen(next);
    if (next) void perform(() => window.katarune.getAgentAccess({ characterId, threadId }));
  }}>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="sm"
      className={`h-7 gap-1.5 rounded-full px-2 text-xs ${full ? "text-orange-600 hover:text-orange-600 aria-expanded:text-orange-600 dark:text-orange-400 dark:hover:text-orange-400 dark:aria-expanded:text-orange-400" : "text-muted-foreground"}`}
      data-testid="agent-access-trigger" aria-label="工具权限" /> }>
      {full ? <ShieldAlertIcon className="size-3.5" /> : <ShieldIcon className="size-3.5" />}
      {full ? "完全访问权限" : state ? "请求批准" : "工具权限"}
      <ChevronDownIcon className="size-3" />
    </PopoverTrigger>
    <PopoverContent side="top" align="start" className="max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-1.5" data-testid="agent-access-menu">
      <PopoverTitle className="sr-only">工具权限</PopoverTitle>
      <div role="group" aria-label="访问模式">
        {modes.map(({ value, label, description, icon: Icon }) => <Button key={value} type="button" variant="ghost"
          className="h-auto w-full justify-start gap-2 rounded-md px-2 py-2 text-left whitespace-normal" disabled={busy || !state || (value === "full-access" && !state.nativeShellAvailable)}
          aria-pressed={state?.mode === value} data-testid={`agent-access-option-${value}`} onClick={() => selectMode(value)}>
          <Icon className={`size-4 shrink-0 ${value === "full-access" ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`} />
          <span className="min-w-0 flex-1"><span className="block text-xs">{label}</span><span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{description}</span></span>
          {state?.mode === value && <CheckIcon className="size-4 shrink-0" />}
        </Button>)}
      </div>
      {state && !state.nativeShellAvailable && <p className="px-2 text-xs text-muted-foreground">完全访问需要本机 Bash；Windows 可安装 Git for Windows。</p>}
      {error && <p role="alert" className="px-2 pb-1 text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
