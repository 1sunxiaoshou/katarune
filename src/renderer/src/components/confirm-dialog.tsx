import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly pendingLabel?: string;
  readonly errorLabel?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => Promise<void>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = "处理中……",
  errorLabel = "操作失败，请重试。",
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorLabel);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent className="sm:max-w-sm" data-testid="confirm-dialog">
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {error !== null && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button data-testid="confirm-dialog-cancel" type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button>
            <Button data-testid="confirm-dialog-confirm" type="submit" variant="destructive" disabled={pending}>{pending ? pendingLabel : confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
