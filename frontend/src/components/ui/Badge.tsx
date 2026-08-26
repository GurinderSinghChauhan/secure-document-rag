import type { HTMLAttributes } from "react";
import { classNames } from "./classNames";

export type BadgeVariant =
  "active" | "suspended" | "metric" | "score" | "super";

const variantClasses: Record<BadgeVariant, string> = {
  active: "status-pill active",
  suspended: "status-pill suspended",
  metric: "metric-pill",
  score: "score-pill",
  super: "super-badge",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={classNames(variantClasses[variant], className)}
    />
  );
}
