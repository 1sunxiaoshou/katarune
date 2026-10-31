import { useState, type ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCharacterSession } from "../characters/CharacterSessionProvider";
import type { ChatFileResult, ChatFileSource } from "../../../shared/agentTools";

export function ChatFileLink({ source, children, className }: { source: ChatFileSource; children: ReactNode; className?: string }) {
  const { activeCharacter } = useCharacterSession();
  const threadId = useAuiState(s => s.threadListItem.remoteId);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<ChatFileResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const access = async (action: "preview" | "open" | "save") => {
    setBusy(true); setError(null);
    if (action === "preview") setFile(null);
    try {
      if (!threadId) throw new Error("请先发送附件。");
      const result = await window.katarune.accessChatFile({ characterId: activeCharacter.id, threadId, source, action });
      if (action === "preview") setFile(result);
    } catch (error) { setError(error instanceof Error ? error.message : "无法读取文件。"); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className={className ?? "text-primary underline underline-offset-2"} onClick={() => { setOpen(true); void access("preview"); }}>{children}</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-3xl" data-testid="chat-file-preview">
        <DialogTitle>{file?.filename ?? "文件"}</DialogTitle>
        {busy && <p role="status" className="text-sm text-muted-foreground">正在读取…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {file && <>
          <p className="text-xs text-muted-foreground">{formatFileSize(file.byteSize)}</p>
          {file.image ? <img src={file.image} alt={file.filename} className="max-h-[60vh] max-w-full object-contain" /> : file.text !== undefined ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{file.text}</pre> : <p className="text-sm text-muted-foreground">此文件暂不支持预览。</p>}
          <div className="flex gap-2">{"path" in source && <Button disabled={busy} variant="outline" onClick={() => void access("open")}>打开</Button>}<Button disabled={busy} onClick={() => void access("save")}>另存为</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}

export function formatFileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function localFilePath(href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[/\\]/i.test(href)) return null;
  try { return decodeURIComponent(href); } catch { return null; }
}
