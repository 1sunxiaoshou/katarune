export const THREAD_LIST_COLLAPSED_STORAGE_KEY =
  "katarune.threadListCollapsed";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function readThreadListCollapsed(storage: ReadableStorage): boolean {
  try {
    return storage.getItem(THREAD_LIST_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeThreadListCollapsed(
  storage: WritableStorage,
  collapsed: boolean,
): void {
  try {
    storage.setItem(
      THREAD_LIST_COLLAPSED_STORAGE_KEY,
      collapsed ? "true" : "false",
    );
  } catch {
    // The preference is optional; a blocked localStorage must not break chat.
  }
}

export function normalizeThreadTitle(value: string): string | null {
  const title = value.trim();
  return title.length === 0 ? null : title;
}
