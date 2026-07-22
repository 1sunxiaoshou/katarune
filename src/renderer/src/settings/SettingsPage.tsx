import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import {
  MODEL_TYPES,
  PROVIDER_TYPES,
  type ModelConfig,
  type ModelType,
  type ProviderConfig,
  type ProviderType,
} from "../../../shared/ipc";
import type { ThemeId } from "../theme";
import { PROVIDER_CATALOG } from "./providerCatalog";

const MODEL_TYPE_LABELS: Readonly<Record<ModelType, string>> = {
  languageModel: "语言模型",
  embeddingModel: "嵌入模型",
  imageModel: "图像生成模型",
  transcriptionModel: "语音识别模型",
  speechModel: "语音生成模型",
  rerankingModel: "重排序模型",
  videoModel: "视频生成模型",
};

interface SettingsPageProps {
  readonly onClose: () => void;
  readonly theme: ThemeId;
  readonly onThemeChange: (theme: ThemeId) => void;
}

type SettingsDataState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly providers: readonly ProviderConfig[];
      readonly models: readonly ModelConfig[];
    };

interface Feedback {
  readonly tone: "success" | "danger" | "warning";
  readonly message: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function optionalUrl(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function StatusBadge({ enabled }: { readonly enabled: boolean }): React.JSX.Element {
  return <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? "已启用" : "已停用"}</Badge>;
}

function FeedbackMessage({ feedback }: { readonly feedback: Feedback | null }): React.JSX.Element | null {
  if (feedback === null) return null;

  const Icon = feedback.tone === "success" ? CheckCircle2Icon : TriangleAlertIcon;
  return (
    <div
      className={
        feedback.tone === "danger"
          ? "flex gap-2 text-sm text-destructive"
          : "flex gap-2 text-sm text-muted-foreground"
      }
      role={feedback.tone === "danger" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{feedback.message}</span>
    </div>
  );
}

interface NewProviderFormProps {
  readonly onCancel: () => void;
  readonly onCreated: (providerId: string) => Promise<void>;
}

function NewProviderForm({ onCancel, onCreated }: NewProviderFormProps): React.JSX.Element {
  const [providerType, setProviderType] = useState<ProviderType>("deepseek");
  const [displayName, setDisplayName] = useState("DeepSeek");
  const [registryId, setRegistryId] = useState("deepseek-main");
  const [baseUrl, setBaseUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const changeProviderType = (nextType: ProviderType): void => {
    setProviderType(nextType);
    setDisplayName(PROVIDER_CATALOG[nextType].label);
    setRegistryId(`${nextType.replaceAll("-", "_")}-main`);
    setBaseUrl("");
    setFeedback(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFeedback(null);

    if (PROVIDER_CATALOG[providerType].baseUrlRequired && baseUrl.trim().length === 0) {
      setFeedback({ tone: "danger", message: "OpenAI Compatible Provider 必须填写 Base URL。" });
      return;
    }

    setSubmitting(true);
    try {
      const provider = await window.katarune.createProviderConfig({
        registryId: registryId.trim(),
        displayName: displayName.trim(),
        providerType,
        baseUrl: optionalUrl(baseUrl),
        settings: null,
        enabled,
      });

      if (secret.length > 0) {
        await window.katarune.replaceProviderCredential({ providerConfigId: provider.id, secret });
      }

      await onCreated(provider.id);
    } catch (error) {
      setFeedback({ tone: "danger", message: errorMessage(error, "无法创建 Provider 配置。") });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Card>
      <CardHeader>
        <CardTitle>添加模型供应商</CardTitle>
        <CardDescription>连接一个 AI SDK Provider，并可选地写入安全凭据。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="new-provider-type">供应商类型</Label>
          <NativeSelect
            id="new-provider-type"
            className="w-full"
            value={providerType}
            onChange={(event) => changeProviderType(event.target.value as ProviderType)}
          >
            {PROVIDER_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {PROVIDER_CATALOG[type].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{PROVIDER_CATALOG[providerType].description}</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="new-provider-name">显示名称</Label>
          <Input
            id="new-provider-name"
            required
            maxLength={200}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="new-provider-registry">Registry ID</Label>
          <Input
            id="new-provider-registry"
            required
            maxLength={63}
            pattern="[a-z0-9][a-z0-9_-]*"
            value={registryId}
            onChange={(event) => setRegistryId(event.target.value)}
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">创建后不可修改，例如 deepseek-main。</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="new-provider-url">
            Base URL{PROVIDER_CATALOG[providerType].baseUrlRequired ? "（必填）" : "（可选）"}
          </Label>
          <Input
            id="new-provider-url"
            type="url"
            required={PROVIDER_CATALOG[providerType].baseUrlRequired}
            placeholder="https://api.example.com/v1"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="new-provider-secret">API Key / Token（可稍后填写）</Label>
          <div className="flex gap-2">
            <Input
              id="new-provider-secret"
              type={showSecret ? "text" : "password"}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
            />
            <TooltipIconButton
              tooltip={showSecret ? "隐藏凭据" : "显示凭据"}
              className="shrink-0"
              type="button"
              onClick={() => setShowSecret((value) => !value)}
            >
              {showSecret ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            </TooltipIconButton>
          </div>
          <p className="text-xs text-muted-foreground">凭据直接进入 Electron main process 加密，不写入 SQLite。</p>
        </div>

        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch id="new-provider-enabled" checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor="new-provider-enabled">启用此 Provider</Label>
        </div>

        <div className="sm:col-span-2">
          <FeedbackMessage feedback={feedback} />
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>取消</Button>
        <Button type="submit" disabled={submitting}>{submitting ? "正在创建……" : "创建 Provider"}</Button>
      </CardFooter>
      </Card>
    </form>
  );
}

interface ProviderEditorProps {
  readonly provider: ProviderConfig;
  readonly models: readonly ModelConfig[];
  readonly onChanged: (preferredProviderId?: string) => Promise<void>;
}

function ProviderEditor({ provider, models, onChanged }: ProviderEditorProps): React.JSX.Element {
  const [displayName, setDisplayName] = useState(provider.displayName);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [enabled, setEnabled] = useState(provider.enabled);
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setDisplayName(provider.displayName);
    setBaseUrl(provider.baseUrl ?? "");
    setEnabled(provider.enabled);
    setSecret("");
    setShowSecret(false);
    setFeedback(null);
  }, [provider]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFeedback(null);

    if (PROVIDER_CATALOG[provider.providerType].baseUrlRequired && baseUrl.trim().length === 0) {
      setFeedback({ tone: "danger", message: "OpenAI Compatible Provider 必须填写 Base URL。" });
      return;
    }

    setSubmitting(true);
    try {
      await window.katarune.updateProviderConfig({
        id: provider.id,
        displayName: displayName.trim(),
        baseUrl: optionalUrl(baseUrl),
        settings: provider.settings,
        enabled,
      });
      if (secret.length > 0) {
        await window.katarune.replaceProviderCredential({ providerConfigId: provider.id, secret });
      }
      setSecret("");
      await onChanged(provider.id);
      setFeedback({ tone: "success", message: "Provider 配置已保存。" });
    } catch (error) {
      setFeedback({ tone: "danger", message: errorMessage(error, "无法保存 Provider 配置。") });
    } finally {
      setSubmitting(false);
    }
  };

  const clearCredential = async (): Promise<void> => {
    if (!window.confirm("清除后，此 Provider 将无法调用需要认证的模型。确定继续吗？")) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await window.katarune.clearProviderCredential({ id: provider.id });
      setSecret("");
      await onChanged(provider.id);
      setFeedback({ tone: "success", message: "凭据已从安全存储清除。" });
    } catch (error) {
      setFeedback({ tone: "danger", message: errorMessage(error, "无法清除凭据。") });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteProvider = async (): Promise<void> => {
    if (!window.confirm(`删除“${provider.displayName}”及其全部模型配置？此操作不可撤销。`)) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await window.katarune.deleteProviderConfig({ id: provider.id });
      await onChanged();
    } catch (error) {
      setFeedback({ tone: "danger", message: errorMessage(error, "无法删除 Provider。") });
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <form onSubmit={(event) => void submit(event)}>
        <Card>
        <CardHeader>
          <CardTitle>{provider.displayName}</CardTitle>
          <CardDescription>{PROVIDER_CATALOG[provider.providerType].description}</CardDescription>
          <CardAction><StatusBadge enabled={provider.enabled} /></CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="text-muted-foreground">类型</p><p className="font-mono">{provider.providerType}</p></div>
            <div><p className="text-muted-foreground">Registry ID</p><p className="font-mono">{provider.registryId}</p></div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="provider-name">显示名称</Label>
              <Input id="provider-name" required maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="provider-url">Base URL{PROVIDER_CATALOG[provider.providerType].baseUrlRequired ? "（必填）" : "（可选）"}</Label>
              <Input id="provider-url" type="url" required={PROVIDER_CATALOG[provider.providerType].baseUrlRequired} placeholder="使用 Provider 默认端点" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
            </div>
          </div>

          <Separator />

          <div className="grid gap-3">
            <div className="flex items-center gap-2"><KeyRoundIcon className="size-4" aria-hidden="true" /><Label htmlFor="provider-secret">安全凭据</Label></div>
            <p className="text-xs text-muted-foreground">{provider.credentialRef === null ? "尚未保存凭据" : "凭据已由系统安全存储加密"}</p>
            <div className="flex gap-2">
              <Input id="provider-secret" type={showSecret ? "text" : "password"} value={secret} placeholder={provider.credentialRef === null ? "粘贴 API Key 或 Token" : "留空表示不修改"} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" spellCheck={false} />
              <TooltipIconButton tooltip={showSecret ? "隐藏凭据" : "显示凭据"} className="shrink-0" type="button" onClick={() => setShowSecret((value) => !value)}>
                {showSecret ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
              </TooltipIconButton>
            </div>
            {provider.credentialRef !== null && <Button className="w-fit" type="button" variant="destructive" size="sm" onClick={() => void clearCredential()} disabled={submitting}>清除凭据</Button>}
          </div>

          <div className="flex items-center gap-3">
            <Switch id="provider-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="provider-enabled">启用此 Provider</Label>
          </div>
          <FeedbackMessage feedback={feedback} />
        </CardContent>
        <CardFooter className="justify-between gap-2">
          <Button type="button" variant="destructive" onClick={() => void deleteProvider()} disabled={submitting}><Trash2Icon data-icon="inline-start" aria-hidden="true" />删除 Provider</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "正在保存……" : "保存更改"}</Button>
        </CardFooter>
        </Card>
      </form>

      <ModelSettings provider={provider} models={models} onChanged={onChanged} />
    </div>
  );
}

interface ModelSettingsProps {
  readonly provider: ProviderConfig;
  readonly models: readonly ModelConfig[];
  readonly onChanged: (preferredProviderId?: string) => Promise<void>;
}

function ModelSettings({ provider, models, onChanged }: ModelSettingsProps): React.JSX.Element {
  const [editingModelId, setEditingModelId] = useState<string | "new" | null>(null);
  const [modelType, setModelType] = useState<ModelType>("languageModel");
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setEditingModelId(null);
    setModelType("languageModel");
    setModelId("");
    setDisplayName("");
    setEnabled(true);
    setFeedback(null);
  }, [provider.id]);

  const beginCreate = (): void => {
    setEditingModelId("new");
    setModelType("languageModel");
    setModelId("");
    setDisplayName("");
    setEnabled(true);
    setFeedback(null);
  };

  const beginEdit = (model: ModelConfig): void => {
    setEditingModelId(model.id);
    setModelType(model.modelType);
    setModelId(model.modelId);
    setDisplayName(model.displayName ?? "");
    setEnabled(model.enabled);
    setFeedback(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      if (editingModelId === "new") {
        await window.katarune.createModelConfig({ providerConfigId: provider.id, modelType, modelId: modelId.trim(), displayName: displayName.trim().length === 0 ? null : displayName.trim(), settings: null, enabled });
      } else if (editingModelId !== null) {
        const previousModel = models.find((model) => model.id === editingModelId);
        if (previousModel === undefined) throw new Error("模型配置已不存在，请刷新后重试。");
        await window.katarune.updateModelConfig({ id: editingModelId, modelType, modelId: modelId.trim(), displayName: displayName.trim().length === 0 ? null : displayName.trim(), settings: previousModel.settings, enabled });
      }
      setEditingModelId(null);
      await onChanged(provider.id);
      setFeedback({ tone: "success", message: "模型配置已保存。" });
    } catch (error) {
      setFeedback({ tone: "danger", message: errorMessage(error, "无法保存模型配置。") });
    } finally {
      setSubmitting(false);
    }
  };

  const testConnection = async (model: ModelConfig): Promise<void> => {
    setSubmitting(true);
    setFeedback({ tone: "warning", message: `正在使用 ${model.displayName ?? model.modelId} 发起最小模型调用……` });
    try {
      const result = await window.katarune.testModelConnection({ id: model.id });
      setFeedback({ tone: result.success ? "success" : "danger", message: `${result.message}（${result.latencyMs} ms）` });
    } catch (error) {
      setFeedback({ tone: "danger", message: errorMessage(error, "连接测试失败。") });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteModel = async (model: ModelConfig): Promise<void> => {
    if (!window.confirm(`删除模型“${model.displayName ?? model.modelId}”？`)) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await window.katarune.deleteModelConfig({ id: model.id });
      if (editingModelId === model.id) setEditingModelId(null);
      await onChanged(provider.id);
      setFeedback({ tone: "success", message: "模型配置已删除。" });
    } catch (error) {
      setFeedback({ tone: "danger", message: errorMessage(error, "无法删除模型配置。") });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>模型配置</CardTitle>
        <CardDescription>模型 ID 由供应商定义；连接测试会产生一次最小的真实调用。</CardDescription>
        <CardAction><Button variant="outline" onClick={beginCreate} disabled={submitting}><PlusIcon data-icon="inline-start" aria-hidden="true" />添加模型</Button></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">此 Provider 还没有模型配置。</p>
        ) : models.map((model) => (
          <div className="flex items-center gap-3" data-testid="model-row" key={model.id}>
            <button className="min-w-0 flex-1 text-left" type="button" onClick={() => beginEdit(model)}>
              <span className="block truncate font-medium">{model.displayName ?? model.modelId}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{model.modelId} · {MODEL_TYPE_LABELS[model.modelType]}</span>
            </button>
            <StatusBadge enabled={model.enabled} />
            <TooltipIconButton tooltip={model.modelType === "languageModel" ? "测试连接（可能产生费用）" : "当前仅支持语言模型连接测试"} onClick={() => void testConnection(model)} disabled={submitting || model.modelType !== "languageModel"}><RefreshCwIcon aria-hidden="true" /></TooltipIconButton>
            <TooltipIconButton tooltip="删除模型" className="text-destructive" onClick={() => void deleteModel(model)} disabled={submitting}><Trash2Icon aria-hidden="true" /></TooltipIconButton>
          </div>
        ))}

        {editingModelId !== null && (
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <h3 className="font-medium">{editingModelId === "new" ? "添加模型" : "编辑模型"}</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="model-type">模型类别</Label>
                <NativeSelect id="model-type" value={modelType} onChange={(event) => setModelType(event.target.value as ModelType)}>
                  {MODEL_TYPES.map((type) => <NativeSelectOption key={type} value={type}>{MODEL_TYPE_LABELS[type]}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2"><Label htmlFor="model-id">厂商模型 ID</Label><Input id="model-id" required maxLength={500} value={modelId} onChange={(event) => setModelId(event.target.value)} spellCheck={false} /></div>
              <div className="grid gap-2"><Label htmlFor="model-name">显示名称（可选）</Label><Input id="model-name" maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
            </div>
            <div className="flex items-center gap-3"><Switch id="model-enabled" checked={enabled} onCheckedChange={setEnabled} /><Label htmlFor="model-enabled">在界面中启用此模型</Label></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditingModelId(null)} disabled={submitting}>取消</Button><Button type="submit" disabled={submitting}>{submitting ? "正在保存……" : "保存模型"}</Button></div>
          </form>
        )}
        <FeedbackMessage feedback={feedback} />
      </CardContent>
    </Card>
  );
}

export function SettingsPage({ onClose, theme, onThemeChange }: SettingsPageProps): React.JSX.Element {
  const [dataState, setDataState] = useState<SettingsDataState>({ status: "loading" });
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [creatingProvider, setCreatingProvider] = useState(false);

  const reload = useCallback(async (preferredProviderId?: string): Promise<void> => {
    try {
      const [providerResult, modelResult] = await Promise.all([
        window.katarune.listProviderConfigs(),
        window.katarune.listModelConfigs(),
      ]);
      setDataState({ status: "ready", providers: providerResult.providerConfigs, models: modelResult.modelConfigs });
      setSelectedProviderId((current) => {
        const preferred = preferredProviderId ?? current;
        if (preferred !== null && providerResult.providerConfigs.some((provider) => provider.id === preferred)) return preferred;
        return providerResult.providerConfigs[0]?.id ?? null;
      });
      setCreatingProvider(false);
    } catch (error) {
      setDataState({ status: "error", message: errorMessage(error, "无法读取设置。") });
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const selectedProvider = useMemo(() => dataState.status === "ready" ? dataState.providers.find((provider) => provider.id === selectedProviderId) : undefined, [dataState, selectedProviderId]);
  const selectedModels = useMemo(() => dataState.status === "ready" && selectedProviderId !== null ? dataState.models.filter((model) => model.providerConfigId === selectedProviderId) : [], [dataState, selectedProviderId]);

  return (
    <main className="h-full overflow-y-auto" id="main-content">
      <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 pb-24 sm:px-6">
        <header className="flex items-start gap-3">
          <TooltipIconButton tooltip="返回对话" className="shrink-0" onClick={onClose}><ArrowLeftIcon aria-hidden="true" /></TooltipIconButton>
          <div><h1 className="text-2xl font-semibold">设置</h1><p className="text-sm text-muted-foreground">管理界面主题、模型供应商与本机安全凭据。</p></div>
        </header>

        <Tabs defaultValue="models">
          <TabsList><TabsTrigger value="models">模型</TabsTrigger><TabsTrigger data-testid="appearance-tab" value="appearance">外观</TabsTrigger></TabsList>

          <TabsContent value="appearance" className="pt-2">
            <Card>
              <CardHeader><CardTitle>界面主题</CardTitle><CardDescription>两套主题使用相同的 shadcn 组件，只切换语义颜色。</CardDescription></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Button data-testid="theme-plana" variant={theme === "plana" ? "default" : "outline"} aria-pressed={theme === "plana"} onClick={() => onThemeChange("plana")}>普拉娜</Button>
                <Button data-testid="theme-arona" variant={theme === "arona" ? "default" : "outline"} aria-pressed={theme === "arona"} onClick={() => onThemeChange("arona")}>阿洛娜</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="models" className="grid gap-4 pt-2">
            <Card>
              <CardHeader><CardTitle>模型供应商</CardTitle><CardDescription>选择已有配置，或添加新的 AI SDK Provider。</CardDescription><CardAction><Button variant="outline" onClick={() => setCreatingProvider(true)}><PlusIcon data-icon="inline-start" aria-hidden="true" />添加</Button></CardAction></CardHeader>
              <CardContent>
                {dataState.status === "loading" && <p className="text-sm text-muted-foreground" role="status">正在读取配置……</p>}
                {dataState.status === "error" && <div className="grid gap-3 text-sm text-destructive" role="alert"><p>{dataState.message}</p><Button className="w-fit" variant="outline" onClick={() => void reload()}>重试</Button></div>}
                {dataState.status === "ready" && dataState.providers.length === 0 && <p className="text-sm text-muted-foreground">尚未添加 Provider。</p>}
                {dataState.status === "ready" && dataState.providers.length > 0 && (
                  <div className="flex items-center gap-3">
                    <NativeSelect className="w-full" value={selectedProviderId ?? ""} onChange={(event) => { setSelectedProviderId(event.target.value); setCreatingProvider(false); }}>
                      {dataState.providers.map((provider) => <NativeSelectOption key={provider.id} value={provider.id}>{provider.displayName} · {PROVIDER_CATALOG[provider.providerType].label}</NativeSelectOption>)}
                    </NativeSelect>
                    {selectedProvider !== undefined && <StatusBadge enabled={selectedProvider.enabled} />}
                  </div>
                )}
              </CardContent>
            </Card>

            {dataState.status === "ready" && (creatingProvider ? (
              <NewProviderForm onCancel={() => setCreatingProvider(false)} onCreated={reload} />
            ) : selectedProvider !== undefined ? (
              <ProviderEditor provider={selectedProvider} models={selectedModels} onChanged={reload} />
            ) : (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">选择一个 Provider，或添加新的模型供应商。</CardContent></Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
