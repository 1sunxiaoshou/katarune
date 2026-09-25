import { ModelSelectorContent, ModelSelectorEmpty, ModelSelectorGroup, ModelSelectorItem, ModelSelectorList, ModelSelectorRoot, ModelSelectorSearch, ModelSelectorTrigger, type ModelOption } from "@/components/model-selector";

export function ModelChoice({ options, value, onChange, label, testId, disabled = false, available = true }: {
  options: ModelOption[]; value: string; onChange: (value: string) => void;
  label: string; testId: string; disabled?: boolean; available?: boolean;
}): React.JSX.Element {
  return <ModelSelectorRoot models={options} value={value} onValueChange={onChange}>
    <ModelSelectorTrigger className="w-full min-w-0" title={options.find((option) => option.id === value)?.name} aria-label={label} data-testid={testId} disabled={disabled} />
    <ModelSelectorContent searchable align="end">
      <ModelSelectorSearch placeholder="搜索…" />
      <ModelSelectorList>
        <ModelSelectorEmpty available={available} />
        <ModelSelectorGroup heading={label}>
          {options.map((option) => <ModelSelectorItem key={option.id} model={option} />)}
        </ModelSelectorGroup>
      </ModelSelectorList>
    </ModelSelectorContent>
  </ModelSelectorRoot>;
}
