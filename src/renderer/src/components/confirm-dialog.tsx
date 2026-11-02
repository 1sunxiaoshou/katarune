import { useState, type FormEvent } from "react";
import { notify } from "../notifications";
import { Form } from "./form";

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

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (cause) {
      notify({ level: "error", message: cause instanceof Error ? cause.message : errorLabel });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent className="sm:max-w-sm" data-testid="confirm-dialog">
        <Form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button data-testid="confirm-dialog-cancel" type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button>
            <Button data-testid="confirm-dialog-confirm" type="submit" variant="destructive" disabled={pending}>{pending ? pendingLabel : confirmLabel}</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
