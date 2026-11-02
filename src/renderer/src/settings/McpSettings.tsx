import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeftIcon, ChevronDownIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormInput, schemaFieldErrors } from "@/components/form";
import { notify } from "../notifications";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { mcpSaveRequestSchema, mcpEnvironmentKeySchema, mcpHeaderKeySchema, mcpHttpUrlSchema, mcpWorkingDirectorySchema, type McpSaveRequest, type McpServer } from "../../../shared/mcp";
import { errorMessage } from "./settingsState";

const statusLabels: Record<McpServer["status"], string> = {
  disabled: "已停用", disconnected: "未连接", connecting: "连接中", connected: "已连接", "auth-required": "需要认证", error: "连接失败",
};
type SecretRow = { key: string; value: string; saved: boolean };

function StringRows({ label, name, values, onChange }: { label: string; name: string; values: string[]; onChange: (values: string[]) => void }) {
  return <div className="grid gap-3">
    <Label>{label}</Label>
    {values.map((value, index) => <div className="flex items-center gap-2" key={index}>
      <FormInput label={label} name={`${name}.${index}`} required={name === "transport.envVars"}
        validate={value => name !== "transport.envVars" || mcpEnvironmentKeySchema.safeParse(value).success ? null : "变量名只能包含字母、数字和下划线，且不能以数字开头。"}
        aria-label={`${label} ${index + 1}`} value={value} onChange={event => onChange(values.map((current, position) => position === index ? event.target.value : current))} />
      <TooltipIconButton type="button" tooltip={`删除${label} ${index + 1}`} onClick={() => onChange(values.filter((_, position) => position !== index))}><Trash2Icon /></TooltipIconButton>
    </div>)}
    <Button variant="secondary" type="button" aria-label={`添加${label}`} onClick={() => onChange([...values, ""])}><PlusIcon />添加{label}</Button>
  </div>;
}

function SecretRows({ label, name, rows, onChange }: { label: string; name: "transport.env" | "transport.headers"; rows: SecretRow[]; onChange: (rows: SecretRow[]) => void }) {
  return <div className="grid gap-3">
    <Label>{label}</Label>
    {rows.map((row, index) => <div className="flex items-start gap-2" key={index}>
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
        <FormInput label={`${label}键`} name={`${name}.${index}.key`} required
          validate={value => (name === "transport.env" ? mcpEnvironmentKeySchema : mcpHeaderKeySchema).safeParse(value).success ? null : `请检查${label}键的格式。`}
          aria-label={`${label}键 ${index + 1}`} placeholder="键" value={row.key} onChange={event => onChange(rows.map((current, position) => position === index ? { ...current, key: event.target.value, saved: false } : current))} />
        <FormInput label={`${label}值`} name={`${name}.${index}.value`} aria-label={`${label}值 ${index + 1}`} type="password" autoComplete="new-password" placeholder={row.saved ? "已保存，留空保持" : "值"} value={row.value}
          onChange={event => onChange(rows.map((current, position) => position === index ? { ...current, value: event.target.value } : current))} />
      </div>
      <TooltipIconButton type="button" tooltip={`删除${label} ${index + 1}`} onClick={() => onChange(rows.filter((_, position) => position !== index))}><Trash2Icon /></TooltipIconButton>
    </div>)}
    <Button variant="secondary" type="button" aria-label={`添加${label}`} onClick={() => onChange([...rows, { key: "", value: "", saved: false }])}><PlusIcon />添加{label}</Button>
  </div>;
}

function McpForm({ server, onBack, onSaved }: { server: McpServer | null; onBack: () => void; onSaved: () => Promise<void> }) {
  const transport = server?.transport;
  const [name, setName] = useState(server?.name ?? "");
  const [type, setType] = useState<"stdio" | "http">(transport?.type ?? "stdio");
  const [command, setCommand] = useState(transport?.type === "stdio" ? transport.command : "");
  const [args, setArgs] = useState(transport?.type === "stdio" ? transport.args : []);
  const [env, setEnv] = useState<SecretRow[]>(transport?.type === "stdio" ? transport.envKeys.map(key => ({ key, value: "", saved: true })) : []);
  const [envVars, setEnvVars] = useState(transport?.type === "stdio" ? transport.envVars : []);
  const [cwd, setCwd] = useState(transport?.type === "stdio" ? transport.cwd : "");
  const [url, setUrl] = useState(transport?.type === "http" ? transport.url : "");
  const [headers, setHeaders] = useState<SecretRow[]>(transport?.type === "http" ? transport.headerKeys.map(key => ({ key, value: "", saved: true })) : []);
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [pending, setPending] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const hasToken = transport?.type === "http" && transport.hasBearerToken && !clearToken;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pairs = (rows: SecretRow[]) => rows.map(row => ({ key: row.key.trim(), ...(!row.saved || row.value ? { value: row.value } : {}) }));
    const connection: McpSaveRequest["transport"] = type === "stdio"
      ? { type, command: command.trim(), args, env: pairs(env), envVars: envVars.map(value => value.trim()), cwd: cwd.trim() }
      : { type, url: url.trim(), headers: pairs(headers), ...(token || clearToken ? { bearerToken: token } : {}) };
    const parsed = mcpSaveRequestSchema.safeParse({ ...(server ? { id: server.id } : {}), name, enabled: server?.enabled ?? true, transport: connection });
    if (!parsed.success) { setValidationErrors(schemaFieldErrors(parsed.error.issues, event.currentTarget)); return; }
    setPending(true); setValidationErrors({});
    try {
      await window.katarune.saveMcpServer(parsed.data);
      await onSaved();
    } catch (cause) { notify({ level: "error", message: errorMessage(cause, "保存失败，请重试。"), dedupeKey: "mcp-save" }); }
    finally { setPending(false); }
  };

  return <Form errors={validationErrors} className="mx-auto grid w-full max-w-3xl gap-5" data-testid="mcp-form"
    onInput={() => { if (Object.keys(validationErrors).length) setValidationErrors({}); }} onSubmit={event => void submit(event)}>
    <div className="flex items-center gap-2">
      <TooltipIconButton type="button" tooltip="返回 MCP 列表" disabled={pending} onClick={onBack}><ArrowLeftIcon /></TooltipIconButton>
      <h2 className="text-lg font-semibold">{server ? "编辑 MCP" : "连接自定义 MCP"}</h2>
    </div>
    <fieldset disabled={pending} className="grid min-w-0 gap-5 disabled:opacity-60">
      <div className="grid gap-4 rounded-xl border p-4">
        <div className="grid gap-2"><Label htmlFor="mcp-name">名称</Label><FormInput label="名称" name="name" id="mcp-name" required maxLength={80} placeholder="MCP 服务名称" value={name} onChange={event => setName(event.target.value)} /></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Label>类型</Label>
          <Tabs value={type} onValueChange={value => { if (value === "stdio" || value === "http") { setType(value); setValidationErrors({}); } }}>
            <TabsList className="flex-row!"><TabsIndicator /><TabsTrigger className="w-auto!" value="stdio">STDIO</TabsTrigger><TabsTrigger className="w-auto!" value="http">流式 HTTP</TabsTrigger></TabsList>
          </Tabs>
        </div>
      </div>
      <div className="grid gap-5 rounded-xl border p-4">
        {type === "stdio" ? <>
          <div className="grid gap-2"><Label htmlFor="mcp-command">启动命令</Label><FormInput label="启动命令" name="transport.command" id="mcp-command" required placeholder="例如 npx、python 或程序路径" value={command} onChange={event => setCommand(event.target.value)} /></div>
          <StringRows label="参数" name="transport.args" values={args} onChange={setArgs} />
          <div className="border-t pt-4"><SecretRows label="环境变量" name="transport.env" rows={env} onChange={setEnv} /></div>
          <div className="grid gap-2 border-t pt-4"><StringRows label="环境变量传递" name="transport.envVars" values={envVars} onChange={setEnvVars} /></div>
          <div className="grid gap-2 border-t pt-4"><Label htmlFor="mcp-cwd">工作目录</Label><FormInput label="工作目录" name="transport.cwd" id="mcp-cwd" validate={value => mcpWorkingDirectorySchema.safeParse(value).success ? null : "工作目录需要使用绝对路径。"} placeholder="可选，使用绝对路径" value={cwd} onChange={event => setCwd(event.target.value)} /></div>
        </> : <>
          <div className="grid gap-2"><Label htmlFor="mcp-url">URL</Label><FormInput label="URL" name="transport.url" id="mcp-url" required type="url" validate={value => mcpHttpUrlSchema.safeParse(value).success ? null : "请填写不含用户名、密码和片段的 HTTP(S) 地址。"} placeholder="https://example.com/mcp" value={url} onChange={event => setUrl(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="mcp-token">Bearer Token</Label><FormInput label="Bearer Token" name="transport.bearerToken" id="mcp-token" type="password" autoComplete="new-password" placeholder={hasToken ? "已保存，留空保持" : "可选"} value={token} onChange={event => setToken(event.target.value)} />
            {hasToken && <Button className="w-fit" variant="ghost" type="button" onClick={() => { setClearToken(true); setToken(""); }}>清除已保存令牌</Button>}
          </div>
          <div className="border-t pt-4"><SecretRows label="请求头" name="transport.headers" rows={headers} onChange={setHeaders} /></div>
        </>}
      </div>
      {type === "http" && <p className="text-xs leading-relaxed text-muted-foreground">请连接你信任的服务；发送给工具的参数会交由该服务处理。</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={onBack}>取消</Button><Button type="submit" data-testid="mcp-save">{pending ? "保存并连接中…" : "保存"}</Button></div>
    </fieldset>
  </Form>;
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const result = await window.katarune.listMcpServers();
    setServers(result);
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const result = await window.katarune.listMcpServers(); if (active) { setServers(result); setLoadError(null); } }
      catch (cause) { if (active) setLoadError(errorMessage(cause, "无法加载 MCP 服务。")); }
      finally { if (active) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    try { await action(); await reload(); }
    catch (cause) { notify({ level: "error", message: errorMessage(cause, "操作失败，请重试。"), dedupeKey: "mcp-operation" }); }
    finally { setBusy(null); }
  };

  if (editing !== null) return <McpForm key={editing === "new" ? "new" : editing.id} server={editing === "new" ? null : editing} onBack={() => setEditing(null)} onSaved={async () => { await reload(); setEditing(null); }} />;
  return <section className="mx-auto grid w-full max-w-3xl gap-5" data-testid="mcp-settings">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">MCP</h2><p className="mt-1 text-sm text-muted-foreground">连接外部工具，扩展角色的能力。</p></div>
      <Button onClick={() => setEditing("new")} data-testid="mcp-add"><PlusIcon />添加 MCP</Button></div>
    {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
    {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : servers.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">还没有 MCP 服务。</p> : <div className="divide-y rounded-xl border">
      {servers.map(server => <div className="min-w-0 p-4" key={server.id} data-testid="mcp-server" data-server-id={server.id}>
        <div className="flex flex-wrap items-center gap-3">
          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={expanded === server.id} onClick={() => setExpanded(expanded === server.id ? null : server.id)}>
            <div className="min-w-0"><div className="truncate font-medium">{server.name}</div><div className="mt-1 text-xs text-muted-foreground">{server.transport.type === "stdio" ? "STDIO" : "流式 HTTP"} · {statusLabels[server.status]}{server.status === "connected" ? ` · ${server.tools.length} 个工具` : ""}</div></div><ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <TooltipIconButton data-testid="mcp-connect" tooltip={`重新连接 ${server.name}`} disabled={busy !== null || !server.enabled} onClick={() => void run(server.id, () => window.katarune.connectMcpServer({ id: server.id }))}><RefreshCwIcon className={busy === server.id ? "animate-spin motion-reduce:animate-none" : ""} /></TooltipIconButton>
            <TooltipIconButton data-testid="mcp-edit" tooltip={`编辑 ${server.name}`} disabled={busy !== null} onClick={() => setEditing(server)}><PencilIcon /></TooltipIconButton>
            <TooltipIconButton data-testid="mcp-delete" tooltip={`删除 ${server.name}`} disabled={busy !== null} onClick={() => setDeleting(server)}><Trash2Icon /></TooltipIconButton>
            <Switch aria-label={`启用 ${server.name}`} checked={server.enabled} disabled={busy !== null} onCheckedChange={enabled => void run(server.id, () => window.katarune.setMcpServerEnabled({ id: server.id, enabled }))} />
          </div>
        </div>
        {server.error && <p role="status" className="mt-3 text-sm text-destructive">{server.error}</p>}
        {expanded === server.id && <div className="mt-4 grid gap-3 border-t pt-4" data-testid="mcp-tools">
          {server.tools.length === 0 ? <p className="text-sm text-muted-foreground">{server.enabled ? "连接成功后显示服务提供的工具。" : "启用并连接后可查看工具。"}</p> : server.tools.map(tool => <div key={tool.name} className="min-w-0"><p className="break-all text-sm font-medium">{tool.name}</p>{tool.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{tool.description}</p>}</div>)}
        </div>}
      </div>)}
    </div>}
    <ConfirmDialog open={deleting !== null} title="删除 MCP" description={`确定删除“${deleting?.name ?? ""}”及其连接配置和保存的凭据吗？`} confirmLabel="删除" onOpenChange={open => { if (!open) setDeleting(null); }}
      onConfirm={async () => { if (deleting) { await window.katarune.deleteMcpServer({ id: deleting.id }); await reload(); } }} />
  </section>;
}
