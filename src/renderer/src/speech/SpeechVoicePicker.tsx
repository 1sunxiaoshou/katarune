import { useState } from "react";
import { parseSpeechModelMetadata, type ModelConfig } from "../../../shared/ipc";
import { ModelSelectorContent, ModelSelectorEmpty, ModelSelectorGroup, ModelSelectorItem, ModelSelectorList, ModelSelectorRoot, ModelSelectorSearch, ModelSelectorSetupButton, ModelSelectorTrigger, type ModelOption } from "@/components/model-selector";
import { selectionCopy } from "@/components/model-selection-copy";

const EMPTY = "__empty_voice__";

export function SpeechVoicePicker({ model, value, onChange, defaultName, onOpenSettings, disabled = false, testId, id }: {
  model: Pick<ModelConfig, "metadata"> | undefined; value: string | null;
  onChange: (voice: string | null) => void; defaultName?: string | null;
  onOpenSettings?: () => void;
  disabled?: boolean; testId: string; id?: string;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const voices = model ? parseSpeechModelMetadata(model.metadata)?.voices ?? [] : [];
  const typedVoice = query.trim();
  const defaultMissing = defaultName === null;
  const options: ModelOption[] = [
    { id: EMPTY, name: !model ? selectionCopy.modelRequired : defaultName === undefined
      ? selectionCopy.voicePlaceholder : defaultName ?? selectionCopy.voicePlaceholder,
      ...(defaultName === undefined ? {} : { badge: "默认" }),
      placeholder: !model || defaultName === undefined || defaultMissing },
    ...voices.map((voice) => ({ id: voice.id, name: voice.displayName, keywords: [voice.id] })),
    ...(value && !voices.some((voice) => voice.id === value) ? [{ id: value, name: value }] : []),
  ];
  // The same search field accepts a custom ID; committing it is an explicit selection.
  if (typedVoice && !options.some((option) => option.id === typedVoice)) {
    options.push({ id: typedVoice, name: `使用 Voice ID：${typedVoice}`, keywords: [typedVoice] });
  }
  if (!model && onOpenSettings) {
    return <ModelSelectorSetupButton id={id} data-testid={testId} aria-label="音色：前往模型设置" onClick={onOpenSettings} />;
  }
  return <ModelSelectorRoot models={options} value={value ?? EMPTY}
    onOpenChange={() => setQuery("")}
    onValueChange={(next) => onChange(next === EMPTY ? null : next)}>
    <ModelSelectorTrigger id={id} className="w-full min-w-0" aria-label="音色" data-testid={testId}
      onSetup={!value && defaultMissing ? onOpenSettings : undefined}
      title={!value && defaultName !== undefined ? `默认音色：${defaultName ?? selectionCopy.voicePlaceholder}` : options.find((option) => option.id === (value ?? EMPTY))?.name} disabled={disabled} />
    <ModelSelectorContent searchable align="end">
      <ModelSelectorSearch aria-label="搜索音色或输入 Voice ID" placeholder={voices.length === 0 ? "输入音色 ID" : "搜索音色或输入 Voice ID…"}
        maxLength={200} value={query} onValueChange={setQuery} />
      <ModelSelectorList>
        <ModelSelectorEmpty kind="voice" available={voices.length > 0 || Boolean(value) || typedVoice.length > 0} />
        <ModelSelectorGroup>
          {options.map((option) => <ModelSelectorItem key={option.id} model={option} />)}
        </ModelSelectorGroup>
      </ModelSelectorList>
    </ModelSelectorContent>
  </ModelSelectorRoot>;
}
