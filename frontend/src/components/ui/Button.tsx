import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { classNames } from "./classNames";

export type ButtonVariant =
  "primary" | "secondary" | "danger" | "text" | "icon-text" | "unstyled";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  busyLabel?: ReactNode;
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string | undefined> = {
  primary: "primary-button",
  secondary: "secondary-button",
  danger: "danger-button",
  text: "text-button",
  "icon-text": "icon-text-button",
  unstyled: undefined,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      busy = false,
      busyLabel,
      children,
      className,
      disabled,
      type = "button",
      variant = "unstyled",
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        className={classNames(variantClasses[variant], className)}
      >
        {busy && busyLabel ? busyLabel : children}
      </button>
    );
  },
);
