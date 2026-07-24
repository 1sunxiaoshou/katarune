import {
  RuntimeAdapterProvider,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  useAui,
} from "@assistant-ui/react";
import type { ExportedMessageRepositoryItem } from "@assistant-ui/react";
import { useMemo, type PropsWithChildren } from "react";

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
      await window.katarune.appendThreadMessage({
        threadId: remoteId,
        characterId: this.characterId,
        message: {
          id: formatAdapter.getId(item.message),
          parent_id: item.parentId,
          format: formatAdapter.format,
          content: formatAdapter.encode(item),
        },
      });
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
    },
    generateTitle: async () =>
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
  };
}
