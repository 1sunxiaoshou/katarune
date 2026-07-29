import "../characters/character-fonts.css";
import {
  ArrowUpDownIcon,
  ArrowLeftIcon,
  AudioLinesIcon,
  BinaryIcon,
  BotIcon,
  CheckIcon,
  CircleHelpIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  MessageSquareTextIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SunIcon,
  Trash2Icon,
  VideoIcon,
  Volume2Icon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProviderLogo } from "@/components/provider-logo";
import {
  clearNotificationScope,
  InlineNotificationOutlet,
  notify,
} from "../notifications";
import { applyTheme, readTheme, type Theme } from "../theme";
import {
  MODEL_TYPES,
  PROVIDER_TYPES,
  type ModelConfig,
  type DiscoveredModel,
  type ModelType,
  type ProviderConfig,
  type ProviderType,
} from "../../../shared/ipc";
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

type ModelCategory = "all" | ModelType;

const MODEL_CATEGORIES: ReadonlyArray<{
  readonly value: ModelCategory;
  readonly label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "languageModel", label: "语言" },
  { value: "embeddingModel", label: "嵌入" },
  { value: "imageModel", label: "图像" },
  { value: "transcriptionModel", label: "语音识别" },
  { value: "speechModel", label: "语音生成" },
  { value: "rerankingModel", label: "重排序" },
  { value: "videoModel", label: "视频" },
];

const MODEL_TYPE_ICONS: Readonly<Record<ModelType, LucideIcon>> = {
  languageModel: MessageSquareTextIcon,
  embeddingModel: BinaryIcon,
  imageModel: ImageIcon,
  transcriptionModel: AudioLinesIcon,
  speechModel: Volume2Icon,
  rerankingModel: ArrowUpDownIcon,
  videoModel: VideoIcon,
};

function findModelCategory(value: string): ModelCategory | undefined {
  return MODEL_CATEGORIES.find((item) => item.value === value)?.value;
}

function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const tokens = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const searchableText = fields.filter((field): field is string => field != null).join(" ").normalize("NFKC").toLocaleLowerCase();
  return tokens.every((token) => searchableText.includes(token));
}

interface SettingsPageProps {
  readonly onClose: () => void;
}

type SettingsDataState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly providers: readonly ProviderConfig[];
      readonly models: readonly ModelConfig[];
    };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function optionalUrl(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function ModelTypeIcon({ type }: { readonly type: ModelType | null }): React.JSX.Element {
  const Icon = type === null ? CircleHelpIcon : MODEL_TYPE_ICONS[type];
  const label = type === null ? "类型未识别" : MODEL_TYPE_LABELS[type];
  return <span className="inline-flex justify-center text-foreground" data-testid="model-type-icon" role="img" aria-label={label} title={label}><Icon className="size-4" aria-hidden="true" /></span>;
}

function ThemeSettings(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(readTheme);

  const selectTheme = (nextTheme: Theme): void => {
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6" aria-labelledby="general-settings-title">
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold" id="general-settings-title">常规</h2>
        <p className="text-sm text-muted-foreground">调整言奏在此设备上的显示方式。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>主题</CardTitle>
          <CardDescription>选择界面的明暗外观，设置会保存在当前设备。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Button
            className="h-auto min-h-24 justify-start gap-3 px-4 py-4 text-left"
            data-testid="theme-light"
            variant={theme === "light" ? "secondary" : "outline"}
            onClick={() => selectTheme("light")}
          >
            <SunIcon className="size-5" aria-hidden="true" />
            <span className="grid gap-1">
              <span>亮色</span>
              <span className="text-xs font-normal text-muted-foreground">明亮、清晰的默认界面</span>
            </span>
          </Button>
          <Button
            className="h-auto min-h-24 justify-start gap-3 px-4 py-4 text-left"
            data-testid="theme-dark"
            variant={theme === "dark" ? "secondary" : "outline"}
            onClick={() => selectTheme("dark")}
          >
            <MoonIcon className="size-5" aria-hidden="true" />
            <span className="grid gap-1">
              <span>暗色</span>
              <span className="text-xs font-normal text-muted-foreground">适合低光环境的深色界面</span>
            </span>
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

function ModelCategoryList(): React.JSX.Element {
  return (
    <div className="mx-auto mt-auto w-fit max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="model-categories">
      <TabsList className="grid h-8! min-w-[32rem] grid-cols-8 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
        {MODEL_CATEGORIES.map((item) => (
          <TabsTrigger
            className="isolate w-full! min-w-0 justify-center! rounded-none px-1.5 text-[10px]! text-primary-foreground/70 before:absolute before:inset-x-1 before:inset-y-0.5 before:-z-10 before:-skew-x-12 before:rounded-sm hover:text-primary-foreground data-active:bg-transparent! data-active:text-foreground data-active:before:bg-background data-active:hover:text-foreground dark:data-active:bg-transparent! dark:data-active:text-foreground dark:data-active:hover:text-foreground"
            key={item.value}
            value={item.value}
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}

interface ProviderDialogProps {
  readonly provider?: ProviderConfig | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (providerId: string) => Promise<void>;
}

const PROVIDER_DIALOG_NOTIFICATION_SCOPE = "settings.provider-dialog";
const MODEL_DIALOG_NOTIFICATION_SCOPE = "settings.model-dialog";

function ProviderDialog({ provider, onOpenChange, onSaved }: ProviderDialogProps): React.JSX.Element {
  const editing = provider !== undefined;
  const [providerType, setProviderType] = useState<ProviderType>(provider?.providerType ?? "deepseek");
  const [displayName, setDisplayName] = useState(provider?.displayName ?? PROVIDER_CATALOG.deepseek.label);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const credentialRequired = provider?.credentialRef == null;

  useEffect(() => () => {
    clearNotificationScope(PROVIDER_DIALOG_NOTIFICATION_SCOPE);
  }, []);

  const changeProviderType = (nextType: ProviderType): void => {
    setProviderType(nextType);
    setDisplayName(PROVIDER_CATALOG[nextType].label);
    setBaseUrl("");
    clearNotificationScope(PROVIDER_DIALOG_NOTIFICATION_SCOPE);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    clearNotificationScope(PROVIDER_DIALOG_NOTIFICATION_SCOPE);

    if (PROVIDER_CATALOG[providerType].baseUrlRequired && baseUrl.trim().length === 0) {
      notify({
        channel: "inline",
        scope: PROVIDER_DIALOG_NOTIFICATION_SCOPE,
        level: "error",
        message: "请填写 Base URL。",
      });
      return;
    }
    if (credentialRequired && secret.length === 0) {
      notify({
        channel: "inline",
        scope: PROVIDER_DIALOG_NOTIFICATION_SCOPE,
        level: "error",
        message: "请填写 API Key。",
      });
      return;
    }

    setSubmitting(true);
    try {
      const savedProvider = editing
        ? await window.katarune.updateProviderConfig({
            id: provider.id,
            displayName: displayName.trim(),
            baseUrl: optionalUrl(baseUrl),
            settings: provider.settings,
            enabled: provider.enabled,
          })
        : await window.katarune.createProviderConfig({
            displayName: displayName.trim(),
            providerType,
            baseUrl: optionalUrl(baseUrl),
            settings: null,
            enabled: true,
          });

      if (secret.length > 0) {
        await window.katarune.replaceProviderCredential({ providerConfigId: savedProvider.id, secret });
      }

      await onSaved(savedProvider.id);
      notify({
        level: "success",
        message: "供应商配置已保存。",
        dedupeKey: `provider-saved:${savedProvider.id}`,
      });
      onOpenChange(false);
    } catch (error) {
      notify({
        channel: "inline",
        scope: PROVIDER_DIALOG_NOTIFICATION_SCOPE,
        level: "error",
        message: errorMessage(error, editing ? "无法保存供应商。" : "无法创建供应商。"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑供应商" : "添加供应商"}</DialogTitle>
            <DialogDescription className="sr-only">填写供应商信息</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="provider-type">类型 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <NativeSelect id="provider-type" className="w-full" disabled={editing} required value={providerType} onChange={(event) => changeProviderType(event.target.value as ProviderType)}>
              {PROVIDER_TYPES.map((type) => <NativeSelectOption key={type} value={type}>{PROVIDER_CATALOG[type].label}</NativeSelectOption>)}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="provider-name">名称 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input id="provider-name" required maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="provider-url">Base URL{PROVIDER_CATALOG[providerType].baseUrlRequired && <> <span className="text-destructive" aria-hidden="true">*</span></>}</Label>
            <Input id="provider-url" type="url" required={PROVIDER_CATALOG[providerType].baseUrlRequired} placeholder={PROVIDER_CATALOG[providerType].baseUrlPlaceholder} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="provider-secret">API Key{credentialRequired && <> <span className="text-destructive" aria-hidden="true">*</span></>}</Label>
            <div className="flex gap-2">
              <Input id="provider-secret" type={showSecret ? "text" : "password"} required={credentialRequired} placeholder={editing && !credentialRequired ? "留空不修改" : undefined} value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" spellCheck={false} />
              <TooltipIconButton tooltip={showSecret ? "隐藏凭据" : "显示凭据"} className="shrink-0" type="button" onClick={() => setShowSecret((value) => !value)}>
                {showSecret ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
              </TooltipIconButton>
            </div>
          </div>

          <InlineNotificationOutlet scope={PROVIDER_DIALOG_NOTIFICATION_SCOPE} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? (editing ? "保存中……" : "创建中……") : (editing ? "保存" : "创建")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ModelSettingsProps {
  readonly provider: ProviderConfig;
  readonly models: readonly ModelConfig[];
  readonly onChanged: (preferredProviderId?: string) => Promise<void>;
}

interface ModelDialogProps {
  readonly provider: ProviderConfig;
  readonly model?: ModelConfig | undefined;
  readonly initialType: ModelType | null;
  readonly initialModelId?: string | undefined;
  readonly initialDisplayName?: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => Promise<void>;
}

function ModelDialog({ provider, model, initialType, initialModelId = "", initialDisplayName = "", onOpenChange, onSaved }: ModelDialogProps): React.JSX.Element {
  const editing = model !== undefined;
  const [modelType, setModelType] = useState<ModelType | null>(model?.modelType ?? initialType);
  const [modelId, setModelId] = useState(model?.modelId ?? initialModelId);
  const [displayName, setDisplayName] = useState(model?.displayName ?? initialDisplayName);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => () => {
    clearNotificationScope(MODEL_DIALOG_NOTIFICATION_SCOPE);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (modelType === null) {
      notify({
        channel: "inline",
        scope: MODEL_DIALOG_NOTIFICATION_SCOPE,
        level: "error",
        message: "请选择模型类别。",
      });
      return;
    }
    setSubmitting(true);
    clearNotificationScope(MODEL_DIALOG_NOTIFICATION_SCOPE);
    try {
      if (editing) {
        await window.katarune.updateModelConfig({
          id: model.id,
          modelType,
          modelId: modelId.trim(),
          displayName: displayName.trim().length === 0 ? null : displayName.trim(),
          settings: model.settings,
          enabled: model.enabled,
        });
      } else {
        await window.katarune.createModelConfig({
          providerConfigId: provider.id,
          modelType,
          modelId: modelId.trim(),
          displayName: displayName.trim().length === 0 ? null : displayName.trim(),
          settings: null,
          enabled: true,
        });
      }
      await onSaved();
      notify({
        level: "success",
        message: "模型配置已保存。",
        dedupeKey: `model-saved:${provider.id}:${modelId.trim()}`,
      });
      onOpenChange(false);
    } catch (error) {
      notify({
        channel: "inline",
        scope: MODEL_DIALOG_NOTIFICATION_SCOPE,
        level: "error",
        message: errorMessage(error, editing ? "无法保存模型。" : "无法添加模型。"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑模型" : "添加模型"}</DialogTitle>
            <DialogDescription className="sr-only">填写模型信息</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="model-type">模型类别 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <NativeSelect id="model-type" className="w-full" required value={modelType ?? ""} onChange={(event) => setModelType(event.target.value.length === 0 ? null : event.target.value as ModelType)}>
              {modelType === null && <NativeSelectOption value="">请选择模型类别</NativeSelectOption>}
              {MODEL_TYPES.map((type) => <NativeSelectOption key={type} value={type}>{MODEL_TYPE_LABELS[type]}</NativeSelectOption>)}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-id">厂商模型 ID <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input id="model-id" required maxLength={500} value={modelId} onChange={(event) => setModelId(event.target.value)} spellCheck={false} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-name">显示名称</Label>
            <Input id="model-name" maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>

          <InlineNotificationOutlet scope={MODEL_DIALOG_NOTIFICATION_SCOPE} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "保存中……" : (editing ? "保存" : "添加")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ModelDialogState =
  | { readonly mode: "create"; readonly modelType: ModelType | null; readonly modelId: string; readonly displayName: string }
  | { readonly mode: "edit"; readonly model: ModelConfig };

type QuickAddState = {
  readonly modelId: string;
  readonly status: "saving" | "saved";
};

function ModelSettings({ provider, models, onChanged }: ModelSettingsProps): React.JSX.Element {
  const [modelDialog, setModelDialog] = useState<ModelDialogState | null>(null);
  const [quickAddState, setQuickAddState] = useState<QuickAddState | null>(null);
  const [category, setCategory] = useState<ModelCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<readonly DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<ModelConfig | null>(null);
  const notificationKeyPrefix = `settings.models:${provider.id}`;

  useEffect(() => {
    setModelDialog(null);
    setCategory("all");
    setSearchQuery("");
    setDiscoveredModels([]);
    setQuickAddState(null);
  }, [provider.id]);

  const beginCreate = (): void => {
    setModelDialog({ mode: "create", modelType: category === "all" ? null : category, modelId: "", displayName: "" });
  };

  const beginEdit = (model: ModelConfig): void => {
    setModelDialog({ mode: "edit", model });
  };

  const discoverModels = async (): Promise<void> => {
    setDiscovering(true);
    try {
      const result = await window.katarune.discoverProviderModels({ id: provider.id });
      setDiscoveredModels(result.models);
      notify({
        channel: "toast",
        level: result.warning === null ? "success" : "warning",
        message: result.warning ?? `获取到 ${result.models.length} 个模型。`,
        dedupeKey: `${notificationKeyPrefix}:discovery`,
      });
    } catch (error) {
      notify({
        channel: "toast",
        level: "error",
        message: errorMessage(error, "无法获取模型列表。"),
        dedupeKey: `${notificationKeyPrefix}:discovery`,
      });
    } finally {
      setDiscovering(false);
    }
  };

  const addDiscoveredModel = async (model: DiscoveredModel): Promise<void> => {
    if (model.modelType === null) {
      setModelDialog({
        mode: "create",
        modelType: null,
        modelId: model.id,
        displayName: model.displayName ?? "",
      });
      return;
    }

    setQuickAddState({ modelId: model.id, status: "saving" });
    try {
      await window.katarune.createModelConfig({
        providerConfigId: provider.id,
        modelType: model.modelType,
        modelId: model.id,
        displayName: model.displayName,
        settings: null,
        enabled: true,
      });
      setQuickAddState({ modelId: model.id, status: "saved" });
      const successDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300;
      await new Promise((resolve) => window.setTimeout(resolve, successDelay));
      await onChanged(provider.id);
      notify({
        level: "success",
        message: "模型配置已保存。",
        dedupeKey: `model-saved:${provider.id}:${model.id}`,
      });
    } catch (error) {
      notify({
        channel: "toast",
        level: "error",
        message: errorMessage(error, "无法添加模型。"),
        dedupeKey: `${notificationKeyPrefix}:quick-add`,
      });
    } finally {
      setQuickAddState(null);
    }
  };

  const testConnection = async (model: ModelConfig): Promise<void> => {
    setSubmitting(true);
    notify({
      channel: "toast",
      level: "loading",
      message: `正在使用 ${model.displayName ?? model.modelId} 发起最小模型调用……`,
      dedupeKey: `${notificationKeyPrefix}:connection`,
    });
    try {
      const result = await window.katarune.testModelConnection({ id: model.id });
      notify({
        channel: "toast",
        level: result.success ? "success" : "error",
        message: `${result.message}（${result.latencyMs} ms）`,
        dedupeKey: `${notificationKeyPrefix}:connection`,
      });
    } catch (error) {
      notify({
        channel: "toast",
        level: "error",
        message: errorMessage(error, "连接测试失败。"),
        dedupeKey: `${notificationKeyPrefix}:connection`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteModel = async (model: ModelConfig): Promise<void> => {
    setSubmitting(true);
    try {
      await window.katarune.deleteModelConfig({ id: model.id });
      await onChanged(provider.id);
      notify({
        level: "success",
        message: "模型配置已删除。",
        dedupeKey: `model-deleted:${model.id}`,
      });
    } catch (error) {
      throw new Error(errorMessage(error, "无法删除模型配置。"));
    } finally {
      setSubmitting(false);
    }
  };

  const setModelEnabled = async (model: ModelConfig, enabled: boolean): Promise<void> => {
    setSubmitting(true);
    try {
      await window.katarune.updateModelConfig({
        id: model.id,
        modelType: model.modelType,
        modelId: model.modelId,
        displayName: model.displayName,
        settings: model.settings,
        enabled,
      });
      await onChanged(provider.id);
    } catch (error) {
      notify({
        channel: "toast",
        level: "error",
        message: errorMessage(error, "无法更新模型启用状态。"),
        dedupeKey: `${notificationKeyPrefix}:enabled`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const changeCategory = (value: string): void => {
    const nextCategory = findModelCategory(value);
    if (nextCategory !== undefined) setCategory(nextCategory);
  };

  const modelRows = (categoryValue: ModelCategory): React.JSX.Element => {
    const visibleModels = models.filter((model) =>
      (categoryValue === "all" || model.modelType === categoryValue) &&
      matchesSearch(searchQuery, [
        model.displayName,
        model.modelId,
      ]),
    );
    const configuredModelIds = new Set(models.map((model) => model.modelId));
    const visibleDiscoveredModels = discoveredModels.filter((model) =>
      !configuredModelIds.has(model.id) &&
      (categoryValue === "all" || model.modelType === categoryValue) &&
      matchesSearch(searchQuery, [
        model.displayName,
        model.id,
      ]),
    );

    if (visibleModels.length === 0 && visibleDiscoveredModels.length === 0) {
      return (
        <div className="grid h-full min-h-40 place-items-center px-6 text-center" data-testid="model-empty-state">
          <div className="grid gap-1">
            <p className="font-medium">{searchQuery.trim().length > 0 ? "没有匹配的模型" : "此分类还没有模型"}</p>
            <p className="text-sm text-muted-foreground">{searchQuery.trim().length > 0 ? "尝试显示名称或模型 ID。" : "添加或获取模型后，它会显示在这里。"}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-2">
        {visibleModels.map((model) => (
          <div
            className="group/model grid h-10 min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_2rem_4rem_5rem] items-center gap-3 rounded-sm px-4 text-foreground"
            data-testid="model-row"
            key={model.id}
          >
            <span className="truncate font-medium" title={model.displayName ?? model.modelId}>{model.displayName ?? model.modelId}</span>
            <span className="truncate font-mono text-xs text-foreground" title={model.displayName !== null && model.displayName !== model.modelId ? model.modelId : undefined}>
              {model.displayName !== null && model.displayName !== model.modelId ? model.modelId : ""}
            </span>
            <ModelTypeIcon type={model.modelType} />
            <Switch
              size="sm"
              className="justify-self-center"
              checked={model.enabled}
              disabled={submitting}
              aria-label={`${model.displayName ?? model.modelId}启用状态`}
              onCheckedChange={(enabled) => void setModelEnabled(model, enabled)}
            />
            <div className="flex w-20 items-center justify-end gap-1 opacity-0 transition-opacity pointer-events-none group-hover/model:pointer-events-auto group-hover/model:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100" data-testid="model-actions">
              <TooltipIconButton tooltip={model.modelType === "languageModel" ? "测试连接（可能产生费用）" : "当前仅支持语言模型连接测试"} onClick={() => void testConnection(model)} disabled={submitting || model.modelType !== "languageModel"}><RefreshCwIcon aria-hidden="true" /></TooltipIconButton>
              <TooltipIconButton data-testid="edit-model" tooltip="编辑模型" onClick={() => beginEdit(model)} disabled={submitting}><PencilIcon aria-hidden="true" /></TooltipIconButton>
              <TooltipIconButton data-testid="delete-model" tooltip="删除模型" onClick={() => setModelToDelete(model)} disabled={submitting}><Trash2Icon aria-hidden="true" /></TooltipIconButton>
            </div>
          </div>
        ))}
        {visibleDiscoveredModels.map((model) => (
          <div className="group/discovered grid h-10 min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_2rem_4rem_5rem] items-center gap-3 rounded-sm px-4" data-testid="discovered-model-row" key={model.id}>
            <button
              className={`min-w-0 cursor-pointer truncate text-left font-medium transition-colors duration-200 motion-reduce:transition-none ${
                quickAddState?.modelId === model.id && quickAddState.status === "saved"
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
              type="button"
              onClick={() => {
                setModelDialog({ mode: "create", modelType: model.modelType, modelId: model.id, displayName: model.displayName ?? "" });
              }}
              title={model.displayName ?? model.id}
            >
              {model.displayName ?? model.id}
            </button>
            <span
              className={`truncate font-mono text-xs transition-colors duration-200 motion-reduce:transition-none ${
                quickAddState?.modelId === model.id && quickAddState.status === "saved"
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
              title={model.displayName !== null && model.displayName !== model.id ? model.id : undefined}
            >
              {model.displayName !== null && model.displayName !== model.id ? model.id : ""}
            </span>
            <ModelTypeIcon type={model.modelType} />
            <span aria-hidden="true" />
            <div className="flex w-20 justify-end opacity-0 transition-opacity pointer-events-none group-hover/discovered:pointer-events-auto group-hover/discovered:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
              <TooltipIconButton
                className={quickAddState?.modelId === model.id && quickAddState.status === "saved" ? "text-foreground disabled:opacity-100" : undefined}
                data-testid="quick-add-model"
                tooltip={model.modelType === null ? "选择类别并添加" : quickAddState?.modelId === model.id && quickAddState.status === "saved" ? "已添加" : "添加此模型"}
                disabled={submitting || discovering || quickAddState !== null}
                onClick={() => void addDiscoveredModel(model)}
              >
                {quickAddState?.modelId === model.id && quickAddState.status === "saved"
                  ? <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out motion-reduce:animate-none" aria-hidden="true" />
                  : <PlusIcon className={quickAddState?.modelId === model.id ? "animate-pulse motion-reduce:animate-none" : ""} aria-hidden="true" />}
              </TooltipIconButton>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <Card className="min-h-[31rem] rounded-none border ring-0 lg:h-full lg:min-h-0" size="sm">
      <CardHeader className="flex flex-row items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="rounded-full pl-8" data-testid="model-search" aria-label="搜索模型" placeholder="搜索模型" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        </div>
        <TooltipIconButton className="size-8" data-testid="add-model" tooltip="添加模型" onClick={beginCreate} disabled={submitting || discovering || quickAddState !== null}><PlusIcon aria-hidden="true" /></TooltipIconButton>
        <TooltipIconButton className="size-8" data-testid="discover-models" tooltip="获取模型列表" onClick={() => void discoverModels()} disabled={submitting || discovering || quickAddState !== null}>
          <DownloadIcon className={discovering ? "animate-pulse" : ""} aria-hidden="true" />
        </TooltipIconButton>
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <Tabs className="min-h-0 min-w-0 flex-1" value={category} onValueChange={changeCategory}>
          {MODEL_CATEGORIES.map((item) => (
            <TabsContent className="min-h-0" key={item.value} value={item.value}>
              {modelRows(item.value)}
            </TabsContent>
          ))}
          <ModelCategoryList />
        </Tabs>
      </CardContent>
      </Card>
      {modelDialog !== null && (
        <ModelDialog
          key={modelDialog.mode === "create" ? `new-${modelDialog.modelId}-${modelDialog.modelType ?? "unknown"}` : modelDialog.model.id}
          provider={provider}
          model={modelDialog.mode === "edit" ? modelDialog.model : undefined}
          initialType={modelDialog.mode === "create" ? modelDialog.modelType : modelDialog.model.modelType}
          initialModelId={modelDialog.mode === "create" ? modelDialog.modelId : undefined}
          initialDisplayName={modelDialog.mode === "create" ? modelDialog.displayName : undefined}
          onOpenChange={(open) => { if (!open) setModelDialog(null); }}
          onSaved={async () => {
            await onChanged(provider.id);
          }}
        />
      )}
      <ConfirmDialog
        open={modelToDelete !== null}
        title="删除模型"
        description={modelToDelete === null ? "" : `确定删除“${modelToDelete.displayName ?? modelToDelete.modelId}”吗？`}
        confirmLabel="删除模型"
        errorLabel="无法删除模型配置。"
        onOpenChange={(open) => { if (!open) setModelToDelete(null); }}
        onConfirm={async () => { if (modelToDelete !== null) await deleteModel(modelToDelete); }}
      />
    </>
  );
}

function EmptyModelPanel({ message }: { readonly message: string }): React.JSX.Element {
  const [category, setCategory] = useState<ModelCategory>("all");

  const changeCategory = (value: string): void => {
    const nextCategory = findModelCategory(value);
    if (nextCategory !== undefined) setCategory(nextCategory);
  };

  return (
    <Card className="min-h-[31rem] rounded-none border ring-0 lg:h-full lg:min-h-0" size="sm">
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Tabs className="min-h-0 min-w-0 flex-1" value={category} onValueChange={changeCategory}>
          {MODEL_CATEGORIES.map((item) => (
            <TabsContent className="grid min-h-80 place-items-center px-6 text-center text-muted-foreground" key={item.value} value={item.value}>
              {message}
            </TabsContent>
          ))}
          <ModelCategoryList />
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface ModelManagementProps {
  readonly dataState: SettingsDataState;
  readonly selectedProviderId: string | null;
  readonly selectedProvider: ProviderConfig | undefined;
  readonly selectedModels: readonly ModelConfig[];
  readonly onSelectProvider: (providerId: string) => void;
  readonly onCreateProvider: () => void;
  readonly onEditProvider: (providerId: string) => void;
  readonly onDeleteProvider: (provider: ProviderConfig) => Promise<void>;
  readonly onReload: (preferredProviderId?: string) => Promise<void>;
}

function ModelManagement({
  dataState,
  selectedProviderId,
  selectedProvider,
  selectedModels,
  onSelectProvider,
  onCreateProvider,
  onEditProvider,
  onDeleteProvider,
  onReload,
}: ModelManagementProps): React.JSX.Element {
  const providers = dataState.status === "ready" ? dataState.providers : [];

  return (
    <section className="grid w-full gap-6 lg:h-full lg:grid-cols-[15rem_minmax(0,1fr)]" aria-labelledby="model-settings-title" data-testid="model-management">
      <Card className="rounded-none border ring-0 lg:h-full" size="sm">
        <CardHeader>
          <CardTitle style={{ alignSelf: "center", gridRow: "span 2" }}>模型供应商</CardTitle>
          <CardAction>
            <TooltipIconButton className="size-8" data-testid="add-provider" tooltip="添加模型供应商" onClick={onCreateProvider}>
              <PlusIcon aria-hidden="true" />
            </TooltipIconButton>
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col" data-testid="provider-list">
          {dataState.status === "loading" && <p className="mb-3 text-sm text-muted-foreground" role="status">正在读取配置……</p>}
          {dataState.status === "error" && <div className="grid gap-3 text-sm text-destructive" role="alert"><p>{dataState.message}</p><Button className="w-fit" variant="outline" onClick={() => void onReload()}>重试</Button></div>}
          {dataState.status === "ready" && providers.length === 0 && <p className="grid flex-1 place-items-center text-sm text-muted-foreground">尚未添加供应商。</p>}
          <div className="grid gap-2">
            {providers.map((provider) => {
              const selected = provider.id === selectedProviderId;
              return (
                <div
                  className={`group/provider flex h-10 min-w-0 items-center rounded-sm transition-colors ${selected ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-muted"}`}
                  data-testid="provider-row"
                  key={provider.id}
                >
                  <button
                    className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    type="button"
                    onClick={() => onSelectProvider(provider.id)}
                  >
                    <ProviderLogo
                      className="size-4 shrink-0"
                      providerType={provider.providerType}
                    />
                    <span className="min-w-0 flex-1 truncate">{provider.displayName}</span>
                  </button>
                  <div className="flex shrink-0 gap-0.5 pr-1 opacity-0 transition-opacity group-hover/provider:opacity-100 group-focus-within/provider:opacity-100" data-testid="provider-actions">
                    <TooltipIconButton className={`size-7 ${selected ? "hover:bg-primary-foreground/15 hover:text-primary-foreground" : ""}`} data-testid="edit-provider" tooltip="编辑供应商" onClick={() => onEditProvider(provider.id)}>
                      <PencilIcon aria-hidden="true" />
                    </TooltipIconButton>
                    <TooltipIconButton className={`size-7 ${selected ? "hover:bg-primary-foreground/15 hover:text-primary-foreground" : ""}`} data-testid="delete-provider" tooltip="删除供应商" onClick={() => void onDeleteProvider(provider)}>
                      <Trash2Icon aria-hidden="true" />
                    </TooltipIconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="min-w-0 lg:h-full">
        <div className="sr-only" id="model-settings-title">模型设置</div>
        {selectedProvider !== undefined ? (
          <ModelSettings provider={selectedProvider} models={selectedModels} onChanged={onReload} />
        ) : (
          <EmptyModelPanel message={dataState.status === "loading" ? "正在读取模型配置……" : "选择一个 Provider，或添加新的模型供应商。"} />
        )}
      </div>
    </section>
  );
}

export function SettingsPage({ onClose }: SettingsPageProps): React.JSX.Element {
  const [dataState, setDataState] = useState<SettingsDataState>({ status: "loading" });
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerDialog, setProviderDialog] = useState<"new" | string | null>(null);
  const [providerToDelete, setProviderToDelete] = useState<ProviderConfig | null>(null);

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
    } catch (error) {
      setDataState({ status: "error", message: errorMessage(error, "无法读取设置。") });
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const selectedProvider = useMemo(() => dataState.status === "ready" ? dataState.providers.find((provider) => provider.id === selectedProviderId) : undefined, [dataState, selectedProviderId]);
  const selectedModels = useMemo(() => dataState.status === "ready" && selectedProviderId !== null ? dataState.models.filter((model) => model.providerConfigId === selectedProviderId) : [], [dataState, selectedProviderId]);

  const selectProvider = (providerId: string): void => {
    setSelectedProviderId(providerId);
  };

  const createProvider = (): void => {
    setProviderDialog("new");
  };

  const deleteProvider = async (provider: ProviderConfig): Promise<void> => {
    try {
      await window.katarune.deleteProviderConfig({ id: provider.id });
      await reload();
      notify({
        level: "success",
        message: "供应商配置已删除。",
        dedupeKey: `provider-deleted:${provider.id}`,
      });
    } catch (error) {
      throw new Error(errorMessage(error, "无法删除供应商。"));
    }
  };

  const dialogProvider = providerDialog !== null && providerDialog !== "new" && dataState.status === "ready"
    ? dataState.providers.find((provider) => provider.id === providerDialog)
    : undefined;

  return (
    <main
      className="relative h-full min-h-0 overflow-y-auto bg-background md:overflow-hidden"
      data-testid="settings-page"
      id="main-content"
    >
      <header className="settings-header">
        <TooltipIconButton
          className="settings-back size-8 rounded-md active:scale-100"
          data-testid="settings-back"
          tooltip="返回聊天"
          onClick={onClose}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </TooltipIconButton>
        <span className="settings-header-star" aria-hidden="true">✦</span>
        <h1>设置</h1>
        <span>SETTINGS</span>
        <div className="settings-header-line" aria-hidden="true" />
      </header>

      <Tabs
        className="mx-auto grid min-h-full w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-6 p-6 pt-20 md:h-full md:min-h-0 md:grid-cols-[8.5rem_minmax(0,1fr)] md:grid-rows-1 md:gap-8 md:px-8 md:py-16 lg:gap-10 lg:py-24"
        defaultValue="general"
        data-testid="settings-workspace"
        orientation="vertical"
      >
        <aside className="min-h-0" aria-label="设置分类">
          <TabsList className="flex-row! w-full items-stretch gap-2 bg-transparent p-0 md:flex-col!">
            <TabsTrigger
              className="min-h-11 w-auto! justify-center px-3 data-active:bg-primary data-active:text-primary-foreground data-active:hover:text-primary-foreground md:w-full! md:justify-start dark:data-active:bg-primary dark:data-active:text-primary-foreground dark:data-active:hover:text-primary-foreground"
              data-testid="settings-tab-general"
              value="general"
            >
              <SlidersHorizontalIcon aria-hidden="true" />
              常规
            </TabsTrigger>
            <TabsTrigger
              className="min-h-11 w-auto! justify-center px-3 data-active:bg-primary data-active:text-primary-foreground data-active:hover:text-primary-foreground md:w-full! md:justify-start dark:data-active:bg-primary dark:data-active:text-primary-foreground dark:data-active:hover:text-primary-foreground"
              data-testid="settings-tab-models"
              value="models"
            >
              <BotIcon aria-hidden="true" />
              模型
            </TabsTrigger>
          </TabsList>
        </aside>

        <div className="min-h-0 md:overflow-y-auto" data-testid="settings-content">
          <TabsContent className="h-full" value="general">
            <ThemeSettings />
          </TabsContent>
          <TabsContent className="h-full" value="models">
            <ModelManagement
              dataState={dataState}
              selectedModels={selectedModels}
              selectedProvider={selectedProvider}
              selectedProviderId={selectedProviderId}
              onCreateProvider={createProvider}
              onDeleteProvider={async (provider) => { setProviderToDelete(provider); }}
              onEditProvider={setProviderDialog}
              onReload={reload}
              onSelectProvider={selectProvider}
            />
          </TabsContent>
        </div>
      </Tabs>

      {(providerDialog === "new" || dialogProvider !== undefined) && (
        <ProviderDialog
          key={providerDialog}
          provider={dialogProvider}
          onOpenChange={(open) => { if (!open) setProviderDialog(null); }}
          onSaved={reload}
        />
      )}

      <ConfirmDialog
        open={providerToDelete !== null}
        title="删除供应商"
        description={providerToDelete === null ? "" : `确定删除“${providerToDelete.displayName}”及其全部模型配置吗？`}
        confirmLabel="删除供应商"
        errorLabel="无法删除供应商。"
        onOpenChange={(open) => { if (!open) setProviderToDelete(null); }}
        onConfirm={async () => { if (providerToDelete !== null) await deleteProvider(providerToDelete); }}
      />

    </main>
  );
}
