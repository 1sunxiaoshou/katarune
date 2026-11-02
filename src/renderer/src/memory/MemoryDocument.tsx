import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { CheckIcon, XIcon, PencilIcon, EraserIcon, NotebookPenIcon } from "lucide-react";
import { useFieldError } from "@/components/form";
import { notify } from "../notifications";
import type { MemoryContent, MemoryEntry } from "../../../shared/memory";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DiaryBody, MemoryStamp } from "./MemoryBody";

const memoryEditorExtensions = [
  StarterKit.configure({ underline: false, link: { openOnClick: false } }),
  Markdown.configure({ markedOptions: { gfm: true } }),
  TableKit, TaskList, TaskItem.configure({ nested: true }),
];

export function MemoryDocument({ characterId, characterName, entry, newKind, editing, onEdit, onForget, onClose, onSaved }: {
  characterId: string; characterName: string; entry: MemoryEntry | null; newKind: "person" | "event";
  editing: boolean; onEdit: () => void; onForget: () => void;
  onClose: () => void; onSaved: (entry: MemoryEntry) => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(entry?.content.title ?? "");
  const [body, setBody] = useState(entry?.content.body ?? "");
  const [isUser, setIsUser] = useState(entry?.content.kind === "person" && entry.content.isUser);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: "title" | "body"; message: string } | null>(null);
  const titleAnchor = useRef<HTMLTextAreaElement>(null);
  const bodyAnchor = useRef<HTMLDivElement>(null);
  useFieldError(titleAnchor, fieldError?.field === "title" ? fieldError.message : null);
  useFieldError(bodyAnchor, fieldError?.field === "body" ? fieldError.message : null);
  const saving = useRef(false);
  const kind = entry?.content.kind ?? newKind;
  const content: MemoryContent = kind === "person" ? { kind, title, body, isUser }
    : kind === "event" ? { kind, title, body }
    : { kind, title, body, day: entry?.content.kind === "diary" ? entry.content.day : "" };

  const editor = useEditor({
    extensions: memoryEditorExtensions,
    editable: editing,
    content: entry?.content.body ?? "",
    contentType: "markdown",
    editorProps: { attributes: { class: "memory-body memory-body-editor", role: "textbox", "aria-label": "正文", "aria-multiline": "true", "data-testid": "memory-body-input", "aria-invalid": fieldError?.field === "body" ? "true" : "false", "aria-describedby": fieldError?.field === "body" ? "memory-body-error" : "" } },
    onUpdate: ({ editor: instance }) => {
      const value = instance.getMarkdown();
      setBody(value);
      setFieldError(current => current?.field === "body" && value.trim() && value.trim().length <= 32000 ? null : current);
    },
  });
  useEffect(() => { if (editor && editor.isEditable !== (editing && !pending)) editor.setEditable(editing && !pending, false); }, [editor, editing, pending]);
  // Keep the document and its scroll position mounted across reading/editing. Only
  // replace content for cancellation or a real background update, never a mode switch.
  useEffect(() => {
    if (editing) return;
    const next = entry?.content;
    setTitle(next?.title ?? "");
    setIsUser(next?.kind === "person" && next.isUser);
    const nextBody = next?.body ?? "";
    if (body !== nextBody) {
      editor?.commands.setContent(nextBody, { contentType: "markdown", emitUpdate: false });
      setBody(nextBody);
    }
    setFieldError(null);
  }, [editor, editing, entry, body]);

  const save = async () => {
    if (!editing || saving.current) return;
    if (!title.trim() || title.trim().length > 120) {
      setFieldError({ field: "title", message: title.trim() ? "标题最多 120 字。" : "请填写标题。" });
      titleAnchor.current?.focus(); return;
    }
    if (!body.trim() || body.trim().length > 32000) {
      setFieldError({ field: "body", message: body.trim() ? "正文最多 32000 字；你的修改仍保留在当前页。" : "请填写正文。" });
      editor?.commands.focus(); return;
    }
    saving.current = true; setPending(true); setFieldError(null);
    try {
      const result = await window.katarune.saveMemory({ characterId, id: entry?.id ?? null, revision: entry?.revision ?? null, content });
      if (result.status === "conflict") throw new Error("这条记忆已被更新。你的修改仍保留，请复制内容后取消并重新打开。");
      onSaved(result.entry);
    } catch (cause) { notify({ level: "error", message: cause instanceof Error ? cause.message : "保存失败，请重试。", dedupeKey: `memory-save:${entry?.id ?? "new"}` }); }
    finally { saving.current = false; setPending(false); }
  };
  const richBody = <EditorContent ref={bodyAnchor} editor={editor} className="rounded-sm field-error-frame" aria-invalid={fieldError?.field === "body" || undefined} />;
  const actions = <div className="memory-document-actions">{editing ? <>
      <TooltipIconButton className="size-8" tooltip="取消编辑" disabled={pending} onClick={onClose} data-testid="memory-cancel"><XIcon aria-hidden /></TooltipIconButton>
      <TooltipIconButton className="size-8" tooltip="保存" disabled={pending} onClick={() => void save()} data-testid="memory-save"><CheckIcon aria-hidden /></TooltipIconButton>
    </> : <>
      <TooltipIconButton className="size-8" tooltip="编辑" onClick={onEdit} data-testid="memory-edit"><PencilIcon aria-hidden /></TooltipIconButton>
      <TooltipIconButton className="size-8" tooltip="遗忘" onClick={onForget} data-testid="memory-forget"><EraserIcon aria-hidden /></TooltipIconButton>
    </>}</div>;
  const heading = <h2><textarea ref={titleAnchor} rows={1} aria-label={kind === "person" ? "姓名或称呼" : "标题"} aria-invalid={fieldError?.field === "title" || undefined} aria-describedby={fieldError?.field === "title" ? "memory-title-error" : undefined} className="memory-title-input rounded-sm field-error-frame" placeholder={kind === "person" ? "姓名或称呼" : "标题"} maxLength={120} value={title} readOnly={!editing} tabIndex={editing ? 0 : -1} disabled={pending} onChange={event => {
    const value = event.target.value.replace(/[\r\n]/g, ""); setTitle(value);
    setFieldError(current => current?.field === "title" && value.trim() && value.trim().length <= 120 ? null : current);
  }} data-testid="memory-title-input" /></h2>;
  const accessibleError = fieldError && <span className="sr-only" id={`memory-${fieldError.field}-error`}>{fieldError.message}</span>;

  return <article className="memory-article" data-editing={editing} data-testid={editing ? "memory-editor" : "memory-detail"} onKeyDown={event => {
    if (!editing || event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
    if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); }
  }}>
    {accessibleError}
    {kind === "diary" ? <>
      <header className="memory-diary-toolbar"><span className="memory-diary-owner"><NotebookPenIcon aria-hidden /><span>{characterName}的日记</span></span>{actions}</header>
      <DiaryBody><div className="memory-diary-entry"><MemoryStamp content={content} />{heading}{richBody}</div></DiaryBody>
    </> : <>
      <div className="memory-article-top"><div className="flex min-w-0 flex-wrap items-center gap-3"><MemoryStamp content={content} />{kind === "person" && editing && <Label className="memory-user-label" htmlFor="memory-is-user">这是你的画像<Switch size="sm" id="memory-is-user" checked={isUser} disabled={pending} onCheckedChange={setIsUser} /></Label>}</div>{actions}</div>
      {heading}
      {richBody}
    </>}
  </article>;
}
