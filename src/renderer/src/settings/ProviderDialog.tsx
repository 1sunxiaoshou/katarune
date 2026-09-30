import { ChevronDownIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProviderLogo } from "@/components/provider-logo";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import {
  clearNotificationScope,
  InlineNotificationOutlet,
  notify,
} from "../notifications";
import {
  PROVIDER_TYPES,
  type DiscoveredModelList,
  type ProviderConfig,
  type ProviderType,
} from "../../../shared/ipc";
import { getProviderCredentialRequirement } from "../../../shared/providers";
import { errorMessage } from "./settingsState";
import { PROVIDER_CATALOG } from "./providerCatalog";

interface ProviderDialogProps {
  readonly provider?: ProviderConfig | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (providerId: string, discovery?: DiscoveredModelList) => Promise<void>;
}

const NOTIFICATION_SCOPE = "settings.provider-dialog";

function optionalUrl(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function ProviderDialog({
  provider,
  onOpenChange,
  onSaved,
}: ProviderDialogProps): React.JSX.Element {
  const editing = provider !== undefined;
  const [providerType, setProviderType] = useState<ProviderType>(provider?.providerType ?? "deepseek");
  const [displayName, setDisplayName] = useState(provider?.displayName ?? PROVIDER_CATALOG.deepseek.label);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [providerTypeOpen, setProviderTypeOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const credentialRequired =
    getProviderCredentialRequirement(providerType).credentialMode === "required";
  const credentialInputRequired =
    credentialRequired && provider?.credentialRef == null;

  useEffect(() => () => {
    clearNotificationScope(NOTIFICATION_SCOPE);
  }, []);

  const changeProviderType = (nextType: ProviderType): void => {
    setProviderType(nextType);
    setDisplayName(PROVIDER_CATALOG[nextType].label);
    setBaseUrl("");
    clearNotificationScope(NOTIFICATION_SCOPE);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    clearNotificationScope(NOTIFICATION_SCOPE);

    if (PROVIDER_CATALOG[providerType].baseUrlRequired && baseUrl.trim().length === 0) {
      notify({ channel: "inline", scope: NOTIFICATION_SCOPE, level: "error", message: "请填写 Base URL。" });
      return;
    }
    if (credentialInputRequired && secret.length === 0) {
      notify({ channel: "inline", scope: NOTIFICATION_SCOPE, level: "error", message: "请填写 API Key。" });
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
        await window.katarune.replaceProviderCredential({
          providerConfigId: savedProvider.id,
          secret,
        });
        setSecret("");
      }

      let discoveryWarning: string | null = null;
      let discovery: DiscoveredModelList | undefined;
      if (!editing) {
        setDiscovering(true);
        try {
          const result = await window.katarune.discoverProviderModels({ id: savedProvider.id, autoAdd: true });
          discovery = result;
          discoveryWarning = result.warning;
        } catch (error) {
          discoveryWarning = `供应商已保存。${errorMessage(error, "无法获取模型列表。")}可在模型页重试。`;
        } finally {
          setDiscovering(false);
        }
      }
      await onSaved(savedProvider.id, discovery);
      notify({
        level: discoveryWarning === null ? "success" : "warning",
        message: discoveryWarning ?? (editing ? "供应商配置已保存。" : "供应商已保存，已自动添加识别到的模型。"),
        dedupeKey: `provider-saved:${savedProvider.id}`,
      });
      onOpenChange(false);
    } catch (error) {
      notify({
        channel: "inline",
        scope: NOTIFICATION_SCOPE,
        level: "error",
        message: errorMessage(error, editing ? "无法保存供应商。" : "无法创建供应商。"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!submitting) onOpenChange(open); }}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑供应商" : "添加供应商"}</DialogTitle>
            <DialogDescription className="sr-only">填写供应商信息</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="provider-type">类型 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Popover open={providerTypeOpen} onOpenChange={setProviderTypeOpen}>
              <PopoverTrigger
                id="provider-type"
                data-testid="provider-type-trigger"
                type="button"
                role="combobox"
                aria-expanded={providerTypeOpen}
                aria-haspopup="listbox"
                disabled={editing}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left shadow-xs outline-none transition-[border-color,box-shadow,background-color] hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-60"
              >
                <span className="flex size-7 shrink-0 items-center justify-center text-foreground">
                  <ProviderLogo providerType={providerType} className="size-[1.125rem]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{PROVIDER_CATALOG[providerType].label}</span>
                  <span className="truncate text-xs text-muted-foreground">{PROVIDER_CATALOG[providerType].description}</span>
                </span>
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 in-aria-expanded:rotate-180" aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={6}
                className="w-(--anchor-width) min-w-80 overflow-hidden rounded-xl p-0 shadow-lg"
              >
                <Command defaultValue={providerType}>
                  <CommandInput data-testid="provider-type-search" placeholder="搜索供应商…" aria-label="搜索供应商" autoFocus />
                  <CommandList className="max-h-72">
                    <CommandEmpty>没有匹配的供应商。</CommandEmpty>
                    <CommandGroup className="p-1.5">
                      {PROVIDER_TYPES.map((type) => {
                        const descriptor = PROVIDER_CATALOG[type];
                        return (
                          <CommandItem
                            key={type}
                            data-testid={`provider-type-option-${type}`}
                            value={type}
                            keywords={[descriptor.label, descriptor.description]}
                            data-checked={providerType === type}
                            className="items-center gap-3 rounded-lg px-2.5 py-2"
                            onSelect={() => {
                              changeProviderType(type);
                              setProviderTypeOpen(false);
                            }}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center text-foreground">
                              <ProviderLogo providerType={type} className="size-[1.125rem]" />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-5">
                              <span className="truncate font-medium">{descriptor.label}</span>
                              <span className="truncate text-xs text-muted-foreground">{descriptor.description}</span>
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
            <Label htmlFor="provider-secret">API Key{credentialInputRequired && <> <span className="text-destructive" aria-hidden="true">*</span></>}</Label>
            <div className="flex gap-2">
              <Input id="provider-secret" type={showSecret ? "text" : "password"} required={credentialInputRequired} placeholder={editing && !credentialInputRequired ? "留空不修改" : credentialRequired ? undefined : "可选，本地服务可留空"} value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" spellCheck={false} />
              <TooltipIconButton tooltip={showSecret ? "隐藏凭据" : "显示凭据"} className="shrink-0" type="button" onClick={() => setShowSecret((value) => !value)}>
                {showSecret ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
              </TooltipIconButton>
            </div>
          </div>

          <InlineNotificationOutlet scope={NOTIFICATION_SCOPE} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
            <Button type="submit" disabled={submitting}>{discovering ? "正在获取并添加模型……" : submitting ? (editing ? "保存中……" : "创建中……") : (editing ? "保存" : "创建")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
