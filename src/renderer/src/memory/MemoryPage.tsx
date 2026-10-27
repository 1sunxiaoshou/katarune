import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { ArrowLeftIcon, BookOpenIcon, NotebookPenIcon, UsersIcon, BookTextIcon, PlusIcon, CircleAlertIcon } from "lucide-react";
import type { MemoryDiaryState, MemoryEntry, MemoryKind, MemoryList } from "../../../shared/memory";
import { diaryFailureMessage } from "../../../shared/memory";
import { assetUrl } from "../../../shared/ipc";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SearchInput } from "@/components/search-input";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/confirm-dialog";
import "./memory.css";

const MemoryDocument = lazy(async () => ({ default: (await import("./MemoryDocument")).MemoryDocument }));

const categories = [{ kind: "diary", label: "日记", icon: NotebookPenIcon }, { kind: "person", label: "人物", icon: UsersIcon }, { kind: "event", label: "纪事", icon: BookTextIcon }] as const;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "无法读取记忆。";

export function MemoryPage({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { activeCharacter } = useCharacterSession();
  return <MemoryWorkspace key={activeCharacter.id} characterId={activeCharacter.id} characterName={activeCharacter.name} portraitAssetId={activeCharacter.packageThumbnailAssetId ?? activeCharacter.packagePortraitAssetId ?? null} onClose={onClose} />;
}

function MemoryWorkspace({ characterId, characterName, portraitAssetId, onClose }: { characterId: string; characterName: string; portraitAssetId: string | null; onClose: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<MemoryKind>("diary");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<MemoryList>({ entries: [], total: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entry, setEntry] = useState<MemoryEntry | null>(null);
  const [diary, setDiary] = useState<MemoryDiaryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<{ entry: MemoryEntry | null; newKind: "person" | "event" } | null>(null);
  const [forgetTarget, setForgetTarget] = useState<MemoryEntry | null>(null);
  const [changingDiary, setChangingDiary] = useState(false);
  const refresh = useCallback(() => setReload(value => value + 1), []);
  useEffect(() => window.katarune.onMemoryChanged(changedId => { if (changedId === characterId) refresh(); }), [characterId, refresh]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = setTimeout(() => {
      void Promise.all([window.katarune.listMemory({ characterId, kind, query, offset }), window.katarune.getMemoryDiaryState({ id: characterId })])
        .then(([nextList, nextDiary]) => {
          if (!active) return;
          setList(nextList); setDiary(nextDiary);
          setSelectedId(current => (nextList.entries.some(item => item.id === current) ? current : nextList.entries[0]?.id ?? null));
        }).catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    }, query ? 180 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [characterId, kind, query, offset, reload]);

  useEffect(() => {
    let active = true;
    setEntry(current => current?.id === selectedId ? current : null);
    if (!selectedId) { setReading(false); return; }
    setReading(true);
    void window.katarune.readMemory({ characterId, id: selectedId }).then(value => { if (active) setEntry(value); })
      .catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setReading(false); });
    return () => { active = false; };
  }, [characterId, selectedId, reload]);

  const switchKind = (value: MemoryKind) => { setKind(value); setQuery(""); setOffset(0); setSelectedId(null); setEntry(null); };
  const onSaved = (saved: MemoryEntry) => { setEditor(null); setEntry(saved); setSelectedId(saved.id); refresh(); };
  const category = categories.find(item => item.kind === kind)!;
  const displayedEntry = editor?.entry ?? entry;
  const formatDay = (day: string) => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${day}T12:00:00`));

  return <main className="memory-page" data-testid="memory-page" id="main-content">
    <header className="settings-header"><TooltipIconButton tooltip="返回聊天" disabled={editor !== null} onClick={onClose} className="size-8" data-testid="memory-back"><ArrowLeftIcon aria-hidden /></TooltipIconButton><span className="settings-header-star" aria-hidden>✦</span><h1>记忆</h1><div className="settings-header-line" aria-hidden /></header>
    <Tabs className="memory-workspace" orientation="vertical" value={kind} onValueChange={value => { if (value === "diary" || value === "person" || value === "event") switchKind(value); }}>
      <aside className="memory-navigation" aria-label="记忆分类">
        <TabsList className="relative isolate flex-row! w-full items-stretch gap-2 bg-transparent p-0 md:flex-col!">
          <TabsIndicator className="settings-tabs-indicator" />
          {categories.map(item => <TabsTrigger key={item.kind} value={item.kind} disabled={editor !== null} className="z-[1] min-h-11 w-auto! justify-center px-3 data-active:bg-transparent! data-active:text-primary-foreground data-active:shadow-none! data-active:hover:text-primary-foreground md:w-full! md:justify-start dark:data-active:bg-transparent! dark:data-active:text-primary-foreground dark:data-active:hover:text-primary-foreground" data-testid={`memory-tab-${item.kind}`}><item.icon aria-hidden />{item.label}</TabsTrigger>)}
        </TabsList>
        <div className="memory-owner" aria-label={`${characterName}的记忆`}><Avatar size="lg" className="after:border-0" aria-hidden="true">{portraitAssetId && <AvatarImage src={assetUrl(portraitAssetId)} alt="" />}<AvatarFallback>✦</AvatarFallback></Avatar><strong title={characterName}>{characterName}</strong></div>
      </aside>
      <TabsContent value={kind} className="memory-panel" data-kind={kind} aria-label={`${category.label}内容`}>
        {error && <div role="alert" className="memory-error flex min-w-0 items-start gap-2 text-sm text-destructive"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden /><p className="min-w-0 flex-1 break-words">{error}</p><Button variant="outline" size="sm" onClick={refresh}>重试</Button></div>}
        <TabsPrimitive.Root className="memory-columns" orientation="vertical" value={selectedId ?? "new"} onValueChange={value => { if (!editor && typeof value === "string") setSelectedId(value); }}>
          <aside className="memory-browser" aria-label="记忆条目">
            <div className="memory-browser-heading"><h2>{category.label}<span>{list.total}</span></h2>{kind !== "diary" && <TooltipIconButton className="size-8" disabled={editor !== null} tooltip={kind === "person" ? "添加人物" : "添加纪事"} onClick={() => setEditor({ entry: null, newKind: kind === "person" ? "person" : "event" })} data-testid="memory-add"><PlusIcon aria-hidden /></TooltipIconButton>}</div>
            <div className="memory-search"><SearchInput disabled={editor !== null} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} placeholder={`搜索${category.label}`} aria-label="搜索记忆" data-testid="memory-search" /></div>
            <TabsPrimitive.List className="memory-list scrollbar-hidden" aria-label={`${category.label}条目`}>
              <TabsIndicator className="settings-tabs-indicator memory-list-indicator" />
              {loading ? <p className="memory-list-hint" role="status">正在读取…</p> : list.entries.length ? list.entries.map(item => <TabsPrimitive.Tab key={item.id} value={item.id} disabled={editor !== null} render={<Button variant="ghost" />} className={`memory-list-item h-auto whitespace-normal rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset${selectedId === item.id ? " is-selected" : ""}`} aria-current={selectedId === item.id ? "true" : undefined} data-testid="memory-list-item">{item.day && <span className="memory-list-meta">{formatDay(item.day)}</span>}<span className="memory-list-title"><strong>{item.title}</strong>{item.kind === "person" && item.isUser && <Badge variant="secondary" className="memory-person-marker" aria-label="你的画像">你</Badge>}</span></TabsPrimitive.Tab>) : <p className="memory-list-hint">{query ? "没有找到匹配内容" : "还没有记忆"}</p>}
              {list.total > 100 && <div className="memory-list-paging"><Button size="sm" variant="ghost" disabled={editor !== null || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>上一组</Button><Button size="sm" variant="ghost" disabled={editor !== null || offset + 100 >= list.total} onClick={() => setOffset(value => value + 100)}>下一组</Button></div>}
            </TabsPrimitive.List>
            {kind === "diary" && <div className="memory-diary-policy"><Label htmlFor="memory-diary-enabled">每日生成日记<Switch size="sm" id="memory-diary-enabled" aria-label="每日生成日记" checked={diary?.enabled ?? false} disabled={changingDiary || !diary} data-testid="memory-diary-toggle" onCheckedChange={enabled => {
              setChangingDiary(true); void window.katarune.setMemoryDiaryEnabled({ characterId, enabled }).then(setDiary).catch(cause => setError(errorText(cause))).finally(() => setChangingDiary(false));
            }} /></Label>{diary?.failed ? <div role="status"><div className="min-w-0 flex-1"><p>{diary.failed} 天生成失败</p><p className="mt-1 break-words" data-testid="memory-diary-failure">{diary.lastFailure?.day}：{diaryFailureMessage(diary.lastFailure?.code ?? null)}</p></div><Button variant="link" size="sm" className="h-auto shrink-0 px-0 py-1 text-xs" disabled={changingDiary || !diary.enabled} data-testid="memory-diary-retry" onClick={() => { setChangingDiary(true); void window.katarune.retryMemoryDiaries({ id: characterId }).then(setDiary).catch(cause => setError(errorText(cause))).finally(() => setChangingDiary(false)); }}>重试</Button></div> : null}</div>}
          </aside>
          <TabsContent value={selectedId ?? "new"} className="memory-reading" aria-label="记忆正文">{editor || entry ?
            <Suspense fallback={<div className="memory-empty" role="status">正在打开记忆…</div>}><MemoryDocument key={editor && !editor.entry ? editor.newKind : displayedEntry?.id} characterId={characterId} characterName={characterName} entry={editor ? editor.entry : entry} newKind={editor?.newKind ?? "event"} editing={editor !== null} onEdit={() => { if (entry) setEditor({ entry, newKind: entry.content.kind === "person" ? "person" : "event" }); }} onForget={() => setForgetTarget(entry)} onClose={() => setEditor(null)} onSaved={onSaved} /></Suspense>
          : reading ? <div className="memory-empty" role="status">正在打开记忆…</div> : <div className="memory-empty"><BookOpenIcon className="size-7" aria-hidden /><h2>{kind === "diary" ? "把相处留在日记里" : kind === "person" ? "慢慢认识身边的人" : "记住一起经历的事"}</h2><p>{query ? "换一个关键词试试。" : kind === "diary" ? "聊过的一天，会在次日按需整理成日记。" : "聊天中值得记住的内容会在这里积累，也可以手动添加。"}</p></div>}</TabsContent>
        </TabsPrimitive.Root>
      </TabsContent>
    </Tabs>
    <ConfirmDialog open={forgetTarget !== null} title="遗忘这条记忆？" description="这条记忆将退出 AI 的回忆，并从列表移除；原聊天记录会保留。" confirmLabel="遗忘" onOpenChange={open => { if (!open) setForgetTarget(null); }} onConfirm={async () => {
      if (!forgetTarget) return;
      const result = await window.katarune.forgetMemory({ characterId, id: forgetTarget.id, revision: forgetTarget.revision });
      if (result.status === "conflict") throw new Error("记忆已更新，请刷新后重试。");
      refresh();
    }} />
  </main>;
}
