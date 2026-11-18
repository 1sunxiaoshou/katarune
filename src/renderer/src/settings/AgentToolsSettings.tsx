import { useEffect, useState } from "react";
import { SearchInput } from "@/components/search-input";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { AgentToolScope, AgentToolSettingsRow } from "../../../shared/agentToolSettings";
import { SettingsSegmentedTabsList } from "./SettingsSegmentedTabsList";
import { errorMessage } from "./settingsState";

const AGENT_SCOPES = [
  { value: "chat", label: "聊天" },
  { value: "desktop", label: "桌宠" },
  { value: "live", label: "直播" },
  { value: "diary", label: "日记" },
] as const satisfies readonly { value: AgentToolScope; label: string }[];

function groupTools(rows: readonly AgentToolSettingsRow[], query: string) {
  const search = query.normalize("NFKC").trim().toLowerCase();
  const groups = new Map<string, { name: string; rows: AgentToolSettingsRow[] }>();
  for (const row of rows) {
    const text = `${row.name} ${row.sourceName} ${row.id} ${row.note ?? ""}`.normalize("NFKC").toLowerCase();
    if (!text.includes(search)) continue;
    const group = groups.get(row.sourceId);
    if (group) group.rows.push(row);
    else groups.set(row.sourceId, { name: row.sourceName, rows: [row] });
  }
  return groups;
}

function AgentToolList({ scope, query }: { scope: AgentToolScope; query: string }): React.JSX.Element {
  const [rows, setRows] = useState<AgentToolSettingsRow[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void window.katarune.listAgentToolSettings({ scope }).then(
      result => { if (active) setRows(result); },
      cause => { if (active) setError(errorMessage(cause, "无法加载工具。")); },
    );
    return () => { active = false; };
  }, [scope]);

  async function setEnabled(id: string, enabled: boolean) {
    setPendingId(id);
    setError("");
    try {
      setRows(await window.katarune.setAgentToolEnabled({ scope, id, enabled }));
    } catch (cause) {
      setError(errorMessage(cause, "无法更新工具。"));
    } finally {
      setPendingId(null);
    }
  }

  const groups = groupTools(rows ?? [], query);
  return (
    <div className={rows ? "content-fade-in grid gap-8" : "grid gap-8"} data-testid="agent-tool-list">
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {rows === null && !error && <p className="py-8 text-center text-muted-foreground" role="status">加载中…</p>}
      {rows !== null && groups.size === 0 && (
        <p className="py-8 text-center text-muted-foreground">{query.trim() ? "没有匹配的工具。" : "暂无工具。"}</p>
      )}
      {[...groups].map(([id, group]) => (
        <section className="grid gap-3" key={id} aria-label={group.name}>
          <h3 className="text-sm font-semibold">{group.name}</h3>
          <Card className="py-0">
            <CardContent>
              <ul className="divide-y">
                {group.rows.map(row => (
                  <li key={row.id} className="flex min-h-16 items-center justify-between gap-3 py-3">
                    <span className={row.enabled ? "min-w-0 break-words font-medium" : "min-w-0 break-words font-medium text-muted-foreground"}>{row.name}</span>
                    {row.configurable && (
                      <div className="flex items-center justify-end gap-3 sm:gap-6">
                        {row.note && <span className="text-right text-xs text-muted-foreground">{row.note}</span>}
                        <Switch
                          aria-label={row.name}
                          checked={row.enabled}
                          disabled={pendingId !== null}
                          onCheckedChange={checked => { void setEnabled(row.id, checked); }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}

export function AgentToolsSettings(): React.JSX.Element {
  const [query, setQuery] = useState("");
  return (
    <Tabs className="mx-auto w-full max-w-3xl gap-8 px-0.5 pb-8" defaultValue="chat" data-testid="agent-tool-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SettingsSegmentedTabsList aria-label="工具使用场景" className="min-w-52 shrink-0 grid-cols-4" options={AGENT_SCOPES} />
        <div className="min-w-36 max-w-72 flex-1">
          <SearchInput
            aria-label="搜索工具"
            placeholder="搜索工具"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </div>
      {AGENT_SCOPES.map(({ value }) => (
        <TabsContent key={value} value={value}><AgentToolList scope={value} query={query} /></TabsContent>
      ))}
    </Tabs>
  );
}
