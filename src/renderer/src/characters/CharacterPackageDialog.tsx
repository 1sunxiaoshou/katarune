import { useEffect, useRef, useState } from "react";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { assetUrl } from "../../../shared/assets";
import {
  DEFAULT_PACKAGE_ID,
  type CharacterPackage,
  type PackageProgress,
} from "../../../shared/characterPackages";

interface Props {
  packageId: string;
  onUse: (id: string) => Promise<void>;
  onClose: () => void;
}
export function CharacterPackageDialog({
  packageId,
  onUse,
  onClose,
}: Props): React.JSX.Element {
  const [packages, setPackages] = useState<CharacterPackage[]>([]);
  const [selectedId, setSelectedId] = useState(packageId || DEFAULT_PACKAGE_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PackageProgress | null>(null);
  const request = useRef<string | null>(null);
  const mounted = useRef(true);
  const refresh = async () => {
    const values = await window.katarune.listCharacterPackages();
    if (mounted.current) setPackages(values);
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((error) => {
      if (mounted.current) setError(String(error));
    });
    const unsubscribe = window.katarune.onCharacterPackageProgress((value) => {
      if (value.requestId === request.current) setProgress(value);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      if (request.current)
        void window.katarune.cancelCharacterPackageImport({
          requestId: request.current,
        });
    };
  }, []);
  const selected = packages.find((p) => p.id === selectedId);
  const systemActions = selected?.manifest.systemActions;
  const defaultSystemActions = packages.find((p) => p.builtin)?.manifest
    .systemActions;
  const idleCount =
    Number(Boolean(systemActions?.idle ?? defaultSystemActions?.idle)) +
    (
      systemActions?.idle_variations ??
      defaultSystemActions?.idle_variations ??
      []
    ).length;
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };
  const importPackage = () =>
    perform(async () => {
      request.current = crypto.randomUUID();
      try {
        const result = await window.katarune.importCharacterPackage({
          requestId: request.current,
        });
        await refresh();
        if (mounted.current && result.package) setSelectedId(result.package.id);
      } finally {
        request.current = null;
      }
    });
  const remove = () =>
    perform(async () => {
      if (!selected) return;
      await window.katarune.deleteCharacterPackage({ id: selected.id });
      await refresh();
      setSelectedId(packageId);
    });
  const close = () => {
    if (request.current)
      void window.katarune.cancelCharacterPackageImport({
        requestId: request.current,
      });
    if (!busy || request.current) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="character-package-dialog"
        showCloseButton={!busy}
        data-testid="character-package-dialog"
      >
        <DialogHeader>
          <DialogTitle>更换形象</DialogTitle>
        </DialogHeader>
        <div className="character-package-body">
          <div className="character-package-list" aria-label="形象列表">
            {packages.map((pack) => (
              <button
                key={pack.id}
                type="button"
                disabled={busy}
                className="character-package-option"
                data-selected={pack.id === selectedId}
                onClick={() => setSelectedId(pack.id)}
                aria-pressed={pack.id === selectedId}
              >
                <img
                  alt=""
                  src={assetUrl(pack.thumbnailAssetId ?? pack.portraitAssetId)}
                />
                <span>
                  {pack.manifest.name}
                  {pack.builtin && <small>内置</small>}
                </span>
              </button>
            ))}
          </div>
          {selected ? (
            <div className="character-package-detail">
              <div className="character-package-art">
                <img
                  alt={`${selected.manifest.name}的立绘`}
                  src={assetUrl(selected.portraitAssetId)}
                />
              </div>
              <div className="character-package-information">
                <h3>{selected.manifest.name}</h3>
                <dl className="character-package-facts">
                  <dt>作者</dt>
                  <dd>{selected.manifest.author ?? "未提供"}</dd>
                  <dt>版本</dt>
                  <dd>{selected.manifest.version}</dd>
                  <dt>待机动作</dt>
                  <dd>{idleCount}</dd>
                  <dt>自定义动作</dt>
                  <dd>{selected.customActions.length}</dd>
                </dl>
                {selected.customActions.length > 0 && (
                  <ul>
                    {selected.customActions.map((action) => (
                      <li key={action.id}>
                        <strong>{action.name}</strong>
                        <span>{action.description}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p role="status">正在读取形象资源……</p>
          )}
        </div>
        {progress && (
          <div role="status">
            {progress.phase === "extracting"
              ? `正在读取资源（${progress.files} 个文件）……`
              : progress.phase === "validating"
                ? "正在验证模型和动作……"
                : "正在保存形象资源……"}
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="character-package-footer">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void importPackage()}
          >
            <DownloadIcon />
            导入
          </Button>
          <Button
            variant="outline"
            disabled={
              busy ||
              !selected ||
              selected.builtin ||
              selected.referenceCount > 0
            }
            title={
              selected?.referenceCount
                ? "角色正在使用此包，请先更换绑定"
                : undefined
            }
            onClick={() => void remove()}
          >
            <Trash2Icon />
            删除
          </Button>
          <span className="flex-1" />
          <Button
            variant="ghost"
            disabled={busy && !request.current}
            onClick={close}
          >
            取消
          </Button>
          <Button
            disabled={busy || !selected}
            onClick={() =>
              void perform(async () => {
                await onUse(selectedId);
                onClose();
              })
            }
          >
            {busy && !request.current ? "正在使用……" : "使用"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
