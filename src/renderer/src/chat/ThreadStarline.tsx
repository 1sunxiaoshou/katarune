import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
  useThreadListItemRuntime,
} from "@assistant-ui/react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { ArchiveIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatThreadTime } from "./threadTime";
import { normalizeThreadTitle } from "./threadSidebarState";

interface ThreadStarlineProps {
  readonly hidden: boolean;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0
    ? cause.message
    : fallback;
}

interface ThreadStarlineItemProps {
  readonly now: Date;
  readonly onError: (message: string | null) => void;
}

function ThreadStarlineItem({
  now,
  onError,
}: ThreadStarlineItemProps): React.JSX.Element {
  const runtime = useThreadListItemRuntime();
  const title = useAuiState((state) => state.threadListItem.title);
  const lastMessageAt = useAuiState(
    (state) => state.threadListItem.lastMessageAt,
  );
  const threadId = useAuiState((state) => state.threadListItem.id);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const active = mainThreadId === threadId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title ?? "");
  const [pending, setPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const cancelledRename = useRef(false);
  const renameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title ?? "");
  }, [editing, title]);

  useEffect(() => {
    if (editing) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [editing]);

  const beginRename = (): void => {
    cancelledRename.current = false;
    setDraft(title ?? "");
    setEditing(true);
    onError(null);
  };

  const saveRename = async (): Promise<void> => {
    if (cancelledRename.current || pending) return;
    const nextTitle = normalizeThreadTitle(draft);
    if (nextTitle === null) {
      setEditing(false);
      setDraft(title ?? "");
      return;
    }
    if (nextTitle === title) {
      setEditing(false);
      return;
    }

    setPending(true);
    onError(null);
    try {
      await runtime.rename(nextTitle);
      setEditing(false);
    } catch (cause) {
      onError(errorMessage(cause, "重命名失败，请重试。"));
      requestAnimationFrame(() => {
        renameInput.current?.focus();
        renameInput.current?.select();
      });
    } finally {
      setPending(false);
    }
  };

  const handleRenameKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelledRename.current = true;
      setDraft(title ?? "");
      setEditing(false);
      onError(null);
    }
  };

  const archive = async (): Promise<void> => {
    setPending(true);
    onError(null);
    try {
      await runtime.archive();
    } catch (cause) {
      onError(errorMessage(cause, "归档失败，请重试。"));
    } finally {
      setPending(false);
    }
  };

  const deleteThread = async (): Promise<void> => {
    onError(null);
    try {
      await runtime.delete();
    } catch (cause) {
      onError(errorMessage(cause, "删除失败，请重试。"));
      throw cause;
    }
  };

  return (
    <ThreadListItemPrimitive.Root
      className="thread-starline-item"
      data-active={active}
      data-testid="thread-starline-item"
      render={<li />}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger className="thread-starline-context-trigger">
          {editing ? (
            <div className="thread-starline-row" data-editing="true">
              <span className="thread-starline-marker" aria-hidden="true">
                {active ? "✦" : ""}
              </span>
              <input
                ref={renameInput}
                className="thread-starline-rename"
                data-testid="thread-rename-input"
                aria-label="重命名会话"
                disabled={pending}
                value={draft}
                onBlur={() => void saveRename()}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={handleRenameKeyDown}
              />
            </div>
          ) : (
            <ThreadListItemPrimitive.Trigger
              className="thread-starline-row"
              data-testid="thread-starline-trigger"
              title={title ?? "未命名会话"}
            >
              <span className="thread-starline-marker" aria-hidden="true">
                {active ? "✦" : ""}
              </span>
              <span className="thread-starline-copy">
                <span className="thread-starline-title">
                  <ThreadListItemPrimitive.Title fallback="未命名会话" />
                </span>
                <time dateTime={lastMessageAt?.toISOString()}>
                  {formatThreadTime(lastMessageAt, now)}
                </time>
              </span>
            </ThreadListItemPrimitive.Trigger>
          )}
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-50" sideOffset={5}>
            <ContextMenu.Popup
              className="thread-context-menu"
              data-testid="thread-context-menu"
            >
              <ContextMenu.Item
                className="thread-context-menu-item"
                data-testid="thread-context-rename"
                disabled={pending}
                onClick={beginRename}
              >
                <PencilIcon aria-hidden="true" />
                重命名
              </ContextMenu.Item>
              <ContextMenu.Item
                className="thread-context-menu-item"
                data-testid="thread-context-archive"
                disabled={pending}
                onClick={() => void archive()}
              >
                <ArchiveIcon aria-hidden="true" />
                归档
              </ContextMenu.Item>
              <ContextMenu.Separator className="thread-context-menu-separator" />
              <ContextMenu.Item
                className="thread-context-menu-item thread-context-menu-danger"
                data-testid="thread-context-delete"
                disabled={pending}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon aria-hidden="true" />
                删除
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <ConfirmDialog
        open={deleteOpen}
        title="删除这个会话？"
        description="会话和其中的全部消息会被永久删除，此操作不可恢复。"
        confirmLabel="删除会话"
        pendingLabel="正在删除……"
        errorLabel="删除失败，请重试。"
        onOpenChange={setDeleteOpen}
        onConfirm={deleteThread}
      />
    </ThreadListItemPrimitive.Root>
  );
}

export function ThreadStarline({
  hidden,
}: ThreadStarlineProps): React.JSX.Element {
  const scrollElement = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const loading = useAuiState((state) => state.threads.isLoading);

  const updateScrollState = useCallback((): void => {
    const element = scrollElement.current;
    if (element === null) return;
    const maximum = element.scrollHeight - element.clientHeight;
    setCanScrollUp(element.scrollTop > 1);
    setCanScrollDown(maximum - element.scrollTop > 1);
  }, []);

  useEffect(() => {
    const element = scrollElement.current;
    if (element === null) return;

    const frame = requestAnimationFrame(updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [threadIds.length, hidden, updateScrollState]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <ThreadListPrimitive.Root className="thread-starline-root">
      <ThreadListPrimitive.New
        className="thread-starline-new"
        data-testid="thread-new"
        onClick={() => setError(null)}
      >
        <span className="thread-starline-new-icon" aria-hidden="true">
          <PlusIcon />
        </span>
        <span>新对话</span>
      </ThreadListPrimitive.New>

      {error !== null && (
        <p className="thread-starline-error" role="alert">
          {error}
        </p>
      )}

      <div className="thread-starline-scroll-frame">
        <div
          className="thread-starline-fade thread-starline-fade-top"
          data-visible={canScrollUp}
          data-testid="thread-fade-top"
          aria-hidden="true"
        />
        <div
          ref={scrollElement}
          className="thread-starline-scroll"
          data-testid="thread-starline-scroll"
          onScroll={updateScrollState}
        >
          {loading && (
            <p className="thread-starline-state" role="status">
              正在读取会话……
            </p>
          )}
          {!loading && threadIds.length === 0 && (
            <p className="thread-starline-state">还没有会话</p>
          )}
          <ol className="thread-starline-list">
            <ThreadListPrimitive.Items>
              {() => <ThreadStarlineItem now={now} onError={setError} />}
            </ThreadListPrimitive.Items>
          </ol>
        </div>
        <div
          className="thread-starline-fade thread-starline-fade-bottom"
          data-visible={canScrollDown}
          data-testid="thread-fade-bottom"
          aria-hidden="true"
        />
      </div>
    </ThreadListPrimitive.Root>
  );
}
