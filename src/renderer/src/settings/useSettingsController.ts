import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderConfig } from "../../../shared/ipc";
import { notify } from "../notifications";
import {
  errorMessage,
  type SettingsDataState,
} from "./settingsState";

export function useSettingsController() {
  const [dataState, setDataState] = useState<SettingsDataState>({
    status: "loading",
  });
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [providerDialog, setProviderDialog] = useState<
    "new" | string | null
  >(null);
  const [providerToDelete, setProviderToDelete] =
    useState<ProviderConfig | null>(null);

  const reload = useCallback(
    async (preferredProviderId?: string): Promise<void> => {
      try {
        const [providerResult, modelResult] = await Promise.all([
          window.katarune.listProviderConfigs(),
          window.katarune.listModelConfigs(),
        ]);
        setDataState({
          status: "ready",
          providers: providerResult.providerConfigs,
          models: modelResult.modelConfigs,
        });
        setSelectedProviderId((current) => {
          const preferred = preferredProviderId ?? current;
          if (
            preferred !== null &&
            providerResult.providerConfigs.some(
              (provider) => provider.id === preferred,
            )
          ) {
            return preferred;
          }
          return providerResult.providerConfigs[0]?.id ?? null;
        });
      } catch (error) {
        setDataState({
          status: "error",
          message: errorMessage(error, "无法读取设置。"),
        });
      }
    },
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedProvider = useMemo(
    () =>
      dataState.status === "ready"
        ? dataState.providers.find(
            (provider) => provider.id === selectedProviderId,
          )
        : undefined,
    [dataState, selectedProviderId],
  );
  const selectedModels = useMemo(
    () =>
      dataState.status === "ready" && selectedProviderId !== null
        ? dataState.models.filter(
            (model) => model.providerConfigId === selectedProviderId,
          )
        : [],
    [dataState, selectedProviderId],
  );
  const dialogProvider =
    providerDialog !== null &&
    providerDialog !== "new" &&
    dataState.status === "ready"
      ? dataState.providers.find(
          (provider) => provider.id === providerDialog,
        )
      : undefined;

  const deleteProvider = async (
    provider: ProviderConfig,
  ): Promise<void> => {
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

  return {
    dataState,
    selectedProviderId,
    selectedProvider,
    selectedModels,
    providerDialog,
    providerToDelete,
    dialogProvider,
    reload,
    selectProvider: setSelectedProviderId,
    createProvider: (): void => setProviderDialog("new"),
    editProvider: setProviderDialog,
    requestProviderDelete: setProviderToDelete,
    closeProviderDialog: (): void => setProviderDialog(null),
    closeProviderDelete: (): void => setProviderToDelete(null),
    deleteProvider,
  };
}
