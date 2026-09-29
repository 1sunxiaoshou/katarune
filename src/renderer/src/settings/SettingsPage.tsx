import "../characters/character-fonts.css";
import { useCallback, useState } from "react";
import type { DiscoveredModelList } from "../../../shared/ipc";
import {
  ArrowLeftIcon,
  BotIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Tabs,
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { ModelManagement } from "./ModelSettings";
import { ProviderDialog } from "./ProviderDialog";
import { GeneralSettings } from "./GeneralSettings";
import { useSettingsController } from "./useSettingsController";
import { useApplicationSettings } from "./ApplicationSettingsProvider";

interface SettingsPageProps {
  readonly onClose: () => void;
  readonly initialTab?: "general" | "models";
}

export function SettingsPage({
  onClose,
  initialTab = "general",
}: SettingsPageProps): React.JSX.Element {
  const controller = useSettingsController();
  const [tab, setTab] = useState<string>(initialTab);
  const [discovery, setDiscovery] = useState<{ providerId: string; result: DiscoveredModelList } | null>(null);
  const { refreshAppSettings } = useApplicationSettings();
  const reload = useCallback(
    async (preferredProviderId?: string): Promise<void> => {
      await Promise.all([
        controller.reload(preferredProviderId),
        refreshAppSettings(),
      ]);
    },
    [controller.reload, refreshAppSettings],
  );

  return (
    <main
      className="settings-page scrollbar-hidden relative h-full min-h-0 overflow-y-auto bg-background md:overflow-hidden"
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
        <div className="settings-header-line" aria-hidden="true" />
      </header>

      <Tabs
        className="grid min-h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-6 px-6 pb-6 pt-20 md:h-full md:min-h-0 md:grid-cols-[8.5rem_minmax(0,1fr)] md:grid-rows-1 md:gap-8 md:px-8 md:pb-5 md:pt-20 lg:gap-10"
        value={tab}
        onValueChange={setTab}
        data-testid="settings-workspace"
        orientation="vertical"
      >
        <aside className="min-h-0" aria-label="设置分类">
          <TabsList className="relative isolate flex-row! w-full items-stretch gap-2 bg-transparent p-0 md:flex-col!">
            <TabsIndicator className="settings-tabs-indicator" />
            <TabsTrigger
              className="z-[1] min-h-11 w-auto! justify-center px-3 data-active:bg-transparent! data-active:text-primary-foreground data-active:shadow-none! data-active:hover:text-primary-foreground md:w-full! md:justify-start dark:data-active:bg-transparent! dark:data-active:text-primary-foreground dark:data-active:hover:text-primary-foreground"
              data-testid="settings-tab-general"
              value="general"
            >
              <SlidersHorizontalIcon aria-hidden="true" />
              常规
            </TabsTrigger>
            <TabsTrigger
              className="z-[1] min-h-11 w-auto! justify-center px-3 data-active:bg-transparent! data-active:text-primary-foreground data-active:shadow-none! data-active:hover:text-primary-foreground md:w-full! md:justify-start dark:data-active:bg-transparent! dark:data-active:text-primary-foreground dark:data-active:hover:text-primary-foreground"
              data-testid="settings-tab-models"
              value="models"
            >
              <BotIcon aria-hidden="true" />
              模型
            </TabsTrigger>
          </TabsList>
        </aside>

        <div
          className="scrollbar-hidden min-h-0 md:overflow-y-auto"
          data-testid="settings-content"
        >
          <TabsContent className="settings-tab-panel h-full" value="general">
            <GeneralSettings dataState={controller.dataState} onOpenModels={() => setTab("models")} onReload={reload} />
          </TabsContent>
          <TabsContent className="settings-tab-panel h-full" value="models">
            <ModelManagement
              discovery={discovery}
              dataState={controller.dataState}
              selectedModels={controller.selectedModels}
              selectedProvider={controller.selectedProvider}
              selectedProviderId={controller.selectedProviderId}
              onCreateProvider={controller.createProvider}
              onDeleteProvider={async (provider) => {
                controller.requestProviderDelete(provider);
              }}
              onEditProvider={controller.editProvider}
              onReload={reload}
              onSelectProvider={controller.selectProvider}
            />
          </TabsContent>
        </div>
      </Tabs>

      {(controller.providerDialog === "new" ||
        controller.dialogProvider !== undefined) && (
        <ProviderDialog
          key={controller.providerDialog}
          provider={controller.dialogProvider}
          onOpenChange={(open) => {
            if (!open) controller.closeProviderDialog();
          }}
          onSaved={async (providerId, result) => {
            if (result) setDiscovery({ providerId, result });
            await reload(providerId);
          }}
        />
      )}

      <ConfirmDialog
        open={controller.providerToDelete !== null}
        title="删除供应商"
        description={
          controller.providerToDelete === null
            ? ""
            : `确定删除“${controller.providerToDelete.displayName}”及其全部模型配置吗？`
        }
        confirmLabel="删除供应商"
        errorLabel="无法删除供应商。"
        onOpenChange={(open) => {
          if (!open) controller.closeProviderDelete();
        }}
        onConfirm={async () => {
          if (controller.providerToDelete !== null) {
            await controller.deleteProvider(controller.providerToDelete);
            await refreshAppSettings();
          }
        }}
      />
    </main>
  );
}
