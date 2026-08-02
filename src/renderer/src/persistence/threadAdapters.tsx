import {
  RuntimeAdapterProvider,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  useAui,
} from "@assistant-ui/react";
import type { ExportedMessageRepositoryItem } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { useMemo, type PropsWithChildren } from "react";

import { notify } from "../notifications";
import { parseAssetUrl } from "../../../shared/ipc";

function extractAssetIds(value: unknown): string[] {
  const assetIds = new Set<string>();
  const visited = new Set<object>();
  const visit = (entry: unknown): void => {
    if (typeof entry !== "object" || entry === null || visited.has(entry)) return;
    visited.add(entry);
    if (
      "type" in entry &&
      entry.type === "file" &&
      "url" in entry &&
      typeof entry.url === "string"
    ) {
      const assetId = parseAssetUrl(entry.url);
      if (assetId !== null) assetIds.add(assetId);
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
    } else {
      for (const child of Object.values(entry)) visit(child);
    }
  };
  visit(value);
  return [...assetIds];
}

function createTitleStream(title?: string) {
  return createAssistantStream((controller) => {
    if (title !== undefined) controller.appendText(title);
  });
}

function toThreadTitleMessages(messages: readonly ThreadMessage[]) {
  return messages
    .filter(
      (message): message is ThreadMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      text: message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000),
    }))
    .filter((message) => message.text.length > 0)
    .slice(0, 12);
}

class KataruneThreadHistoryAdapter implements ThreadHistoryAdapter {
  public constructor(
    private readonly aui: ReturnType<typeof useAui>,
    private readonly characterId: string,
  ) {}

  public async load(): Promise<{ messages: [] }> {
    return { messages: [] };
  }

  public async append(_item: ExportedMessageRepositoryItem): Promise<void> {
    throw new Error("Katarune history requires a framework message format adapter.");
  }

  public withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): GenericThreadHistoryAdapter<TMessage> {
    const getRemoteId = (): string | undefined =>
      this.aui.threadListItem().getState().remoteId;

    const persist = async (item: MessageFormatItem<TMessage>): Promise<void> => {
      const { remoteId } = await this.aui.threadListItem().initialize();
      const content = formatAdapter.encode(item);
      await window.katarune.appendThreadMessage({
        threadId: remoteId,
        characterId: this.characterId,
        message: {
          id: formatAdapter.getId(item.message),
          parent_id: item.parentId,
          format: formatAdapter.format,
          content,
        },
        assetIds: extractAssetIds(content),
      });
      try {
        await this.aui.threads().reload();
      } catch {
        // The message is already durable; a later list load can recover metadata.
      }
    };

    return {
      load: async () => {
        const remoteId = getRemoteId();
        if (remoteId === undefined) return { messages: [] };

        const repository = await window.katarune.loadThreadMessages({
          threadId: remoteId,
          characterId: this.characterId,
        });
        return {
          messages: repository.messages
            .filter((message) => message.format === formatAdapter.format)
            .map((message) =>
              formatAdapter.decode({
                ...message,
                content: message.content as TStorageFormat,
              }),
            ),
        };
      },
      append: persist,
      update: async (item) => persist(item),
      delete: async (items) => {
        const remoteId = getRemoteId();
        if (remoteId === undefined || items.length === 0) return;
        await window.katarune.deleteThreadMessages({
          threadId: remoteId,
          characterId: this.characterId,
          messageIds: items.map((item) => formatAdapter.getId(item.message)),
        });
      },
    };
  }
}

export function createKataruneThreadListAdapter(
  characterId: string,
): RemoteThreadListAdapter {
  function ThreadPersistenceProvider({
    children,
  }: PropsWithChildren): React.JSX.Element {
    const aui = useAui();
    const history = useMemo(
      () => new KataruneThreadHistoryAdapter(aui, characterId),
      [aui],
    );
    const adapters = useMemo(() => ({ history }), [history]);

    return (
      <RuntimeAdapterProvider adapters={adapters}>
        {children}
      </RuntimeAdapterProvider>
    );
  }

  return {
    unstable_Provider: ThreadPersistenceProvider,
    list: () => window.katarune.listThreads({ characterId }),
    initialize: async (threadId) => {
      const thread = await window.katarune.initializeThread({ threadId, characterId });
      return { remoteId: thread.remoteId, externalId: undefined };
    },
    fetch: (threadId) => window.katarune.fetchThread({ threadId, characterId }),
    rename: async (remoteId, newTitle) => {
      await window.katarune.renameThread({
        threadId: remoteId,
        characterId,
        title: newTitle,
      });
    },
    archive: async (remoteId) => {
      await window.katarune.setThreadStatus({
        threadId: remoteId,
        characterId,
        status: "archived",
      });
      notify({
        level: "success",
        message: "会话已归档。",
        dedupeKey: `thread-archive:${remoteId}`,
      });
    },
    unarchive: async (remoteId) => {
      await window.katarune.setThreadStatus({
        threadId: remoteId,
        characterId,
        status: "regular",
      });
    },
    delete: async (remoteId) => {
      await window.katarune.deleteThread({ threadId: remoteId, characterId });
      notify({
        level: "success",
        message: "会话已删除。",
        dedupeKey: `thread-deleted:${remoteId}`,
      });
    },
    generateTitle: async (remoteId, messages) => {
      const titleMessages = toThreadTitleMessages(messages);
      if (titleMessages.length === 0) return createTitleStream();
      try {
        const { title } = await window.katarune.generateThreadTitle({
          threadId: remoteId,
          characterId,
          messages: titleMessages,
        });
        return createTitleStream(title);
      } catch {
        return createTitleStream();
      }
    },
  };
}
