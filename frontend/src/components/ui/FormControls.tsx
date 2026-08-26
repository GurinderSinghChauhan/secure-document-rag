import {
  cloneElement,
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

interface FormFieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-labelledby"?: string;
  }>;
  error?: string;
  hint?: string;
  label: ReactNode;
  labelHidden?: boolean;
}

export function FormField({
  children,
  className,
  error,
  hint,
  label,
  labelHidden = false,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const controlId = children.props.id ?? `${generatedId}-control`;
  const labelId = `${generatedId}-label`;
  const hintId = hint ? `${generatedId}-hint` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], hintId, errorId]
    .filter(Boolean)
    .join(" ");
  return (
    <label {...props} className={className} htmlFor={controlId}>
      <span id={labelId} className={labelHidden ? "sr-only" : undefined}>
        {label}
      </span>
      {cloneElement(children, {
        id: controlId,
        "aria-labelledby": children.props["aria-labelledby"] ?? labelId,
        "aria-describedby": describedBy || undefined,
      })}
      {hint && <small id={hintId}>{hint}</small>}
      {error && (
        <small id={errorId} role="alert">
          {error}
        </small>
      )}
    </label>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input {...props} ref={ref} className={className} />;
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return <select {...props} ref={ref} className={className} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea {...props} ref={ref} className={className} />;
});
