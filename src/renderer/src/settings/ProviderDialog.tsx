import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
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
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import {
  clearNotificationScope,
  InlineNotificationOutlet,
  notify,
} from "../notifications";
import {
  PROVIDER_TYPES,
  type ProviderConfig,
  type ProviderType,
} from "../../../shared/ipc";
import { getProviderCredentialRequirement } from "../../../shared/providers";
import { errorMessage } from "./settingsState";
import { PROVIDER_CATALOG } from "./providerCatalog";

interface ProviderDialogProps {
  readonly provider?: ProviderConfig | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (providerId: string) => Promise<void>;
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
        scope: NOTIFICATION_SCOPE,
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
            <Button type="submit" disabled={submitting}>{submitting ? (editing ? "保存中……" : "创建中……") : (editing ? "保存" : "创建")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
