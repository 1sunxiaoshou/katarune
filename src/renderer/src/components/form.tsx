import { useEffect, useId, useRef, type ComponentProps, type RefObject } from "react";
import { Field } from "@base-ui/react/field";
import { Input } from "@/components/ui/input";
import { dismissNotification, notify } from "../notifications";

export { Form } from "@base-ui/react/form";

/** A single anchored error, also usable by custom editors without an HTML form. */
export function useFieldError(anchorRef: RefObject<HTMLElement | null>, message: string | null): void {
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || !message) return;
    const document = anchor.ownerDocument;
    let open = false;
    let notificationId: string | undefined;
    const show = () => {
      const current = anchorRef.current;
      if (!current?.contains(document.activeElement)) return;
      if (open) return;
      open = true;
      notificationId = notify({ level: "error", message, anchor: current, onClose: () => { open = false; } });
    };
    const hide = () => { open = false; if (notificationId) dismissNotification(notificationId); notificationId = undefined; };
    const focusIn = () => {
      if (anchorRef.current?.contains(document.activeElement)) show();
      else if (open) hide();
    };
    const focusOut = (event: FocusEvent) => {
      if (open && (!(event.relatedTarget instanceof Node) || !anchorRef.current?.contains(event.relatedTarget))) hide();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open && anchorRef.current?.contains(document.activeElement)) { event.preventDefault(); event.stopPropagation(); hide(); }
    };
    document.addEventListener("focusin", focusIn, true);
    document.addEventListener("focusout", focusOut, true);
    document.addEventListener("keydown", keyDown, true);
    show();
    return () => {
      hide();
      document.removeEventListener("focusin", focusIn, true);
      document.removeEventListener("focusout", focusOut, true);
      document.removeEventListener("keydown", keyDown, true);
    };
  }, [anchorRef, message]);
}

function FieldFeedback({ state, label, anchorRef, disabled }: {
  state: Field.Validity.State; label: string; anchorRef: RefObject<HTMLInputElement | null>; disabled: boolean;
}) {
  const validity = state.validity;
  const message = disabled || validity.valid !== false ? null
    : validity.customError ? state.errors[0] || state.error
      : validity.valueMissing ? `请填写${label}。`
        : validity.typeMismatch ? `请填写有效的${label}。`
          : validity.tooLong ? `${label}超出长度限制。`
            : validity.tooShort ? `${label}长度不足。`
              : validity.rangeOverflow || validity.rangeUnderflow || validity.stepMismatch || validity.badInput ? `请检查${label}的数值范围。`
                : validity.patternMismatch ? `请检查${label}的格式。` : state.errors[0] || state.error;
  return <Field.Error className="sr-only" {...(message ? { children: message } : {})}
    render={props => <FieldErrorText {...props} anchorRef={anchorRef} />} />;
}

function FieldErrorText({ anchorRef, children, ...props }: ComponentProps<"div"> & { anchorRef: RefObject<HTMLInputElement | null> }) {
  useFieldError(anchorRef, typeof children === "string" ? children : null);
  return <div {...props}>{children}</div>;
}

type FormInputProps = Omit<ComponentProps<typeof Input>, "ref"> & {
  label: string;
  validate?: Field.Root.Props["validate"];
};

/** Base UI owns native constraints, field state, revalidation and error focus. */
export function FormInput({ label, validate, ...props }: FormInputProps) {
  const anchor = useRef<HTMLInputElement>(null);
  const generatedName = useId();
  return <Field.Root className="contents" name={props.name ?? props.id ?? generatedName} disabled={props.disabled}
    validate={(value, values) => props.required && typeof value === "string" && !value.trim() ? `请填写${label}。` : validate?.(value, values) ?? null}>
    <Input {...props} ref={anchor} />
    <Field.Validity>{state => <FieldFeedback state={state} label={label} anchorRef={anchor} disabled={props.disabled ?? false} />}</Field.Validity>
  </Field.Root>;
}

/** Map boundary-schema issues onto the mounted Base UI field names. */
export function schemaFieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[], form: HTMLFormElement): Record<string, string> {
  const names = Array.from(form.querySelectorAll<HTMLInputElement>("input[name]")).map(input => input.name);
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".");
    const name = names.find(name => name === path) ?? names.find(name => name.startsWith(`${path}.`)) ?? names[0];
    if (name && !Object.hasOwn(errors, name)) errors[name] = issue.message;
  }
  return errors;
}
