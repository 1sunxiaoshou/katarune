import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { TooltipIconButton } from "./tooltip-icon-button";

interface PageHeaderProps {
  title: string;
  onBack: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  backTestId?: string;
  overlay?: boolean;
  trailing?: ReactNode;
}

export function PageHeader({ title, onBack, backLabel = "返回聊天", backDisabled, backTestId, overlay = false, trailing }: PageHeaderProps) {
  return (
    <header className="page-header" data-overlay={overlay || undefined}>
      <TooltipIconButton className="size-8 shrink-0" tooltip={backLabel} aria-label={backLabel} onClick={onBack} disabled={backDisabled} data-testid={backTestId}>
        <ArrowLeftIcon aria-hidden="true" />
      </TooltipIconButton>
      <span className="page-header-star" aria-hidden="true">✦</span>
      <h1>{title}</h1>
      <div className="page-header-line" aria-hidden="true" />
      {trailing != null ? <div className="page-header-trailing">{trailing}</div> : null}
    </header>
  );
}
