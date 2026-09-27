import { ModelSelectorSetupButton, ModelSelectorContent, ModelSelectorEmpty, ModelSelectorGroup, ModelSelectorItem, ModelSelectorList, ModelSelectorRoot, ModelSelectorSearch, ModelSelectorTrigger, type ModelOption } from "@/components/model-selector";

export function ModelChoice({ options, value, onChange, label, testId, disabled = false, available = true, onOpenSettings }: {
  options: ModelOption[]; value: string; onChange: (value: string) => void;
  label: string; testId: string; disabled?: boolean; available?: boolean; onOpenSettings?: () => void;
}): React.JSX.Element {
  const warning = options.some((option) => option.id === value && option.disabled);
  if (!available && onOpenSettings) return <ModelSelectorSetupButton warning={warning} disabled={disabled} data-testid={testId} aria-label={`${label}：前往模型设置`} onClick={onOpenSettings} />;
  const searchable = options.filter((option) => !option.disabled).length > 6;
  return <ModelSelectorRoot models={options} value={value} onValueChange={onChange}>
    <ModelSelectorTrigger className="w-full min-w-0" title={options.find((option) => option.id === value)?.name} aria-label={label} data-testid={testId} disabled={disabled} />
    <ModelSelectorContent searchable={searchable} align="end">
      {searchable && <ModelSelectorSearch placeholder="搜索…" />}
      <ModelSelectorList>
        <ModelSelectorEmpty />
        <ModelSelectorGroup>
          {options.map((option) => <ModelSelectorItem key={option.id} model={option} />)}
        </ModelSelectorGroup>
      </ModelSelectorList>
    </ModelSelectorContent>
  </ModelSelectorRoot>;
}
