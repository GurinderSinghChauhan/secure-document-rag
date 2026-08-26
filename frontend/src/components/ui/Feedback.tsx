import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "./classNames";

interface StatusMessageProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

export function StatusMessage({
  children,
  className,
  ...props
}: StatusMessageProps) {
  return (
    <p {...props} className={className} role="status">
      {children}
    </p>
  );
}

interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  children?: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}

export function EmptyState({
  children,
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div {...props} className={classNames("empty-state", className)}>
      {icon && (
        <span className="empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}

interface ProgressBarProps {
  label: string;
  showValue?: boolean;
  value: number;
  variant?: "upload" | "job";
}

export function ProgressBar({
  label,
  showValue = false,
  value,
  variant = "upload",
}: ProgressBarProps) {
  const rounded = Math.max(0, Math.min(100, Math.round(value)));
  if (variant === "job")
    return (
      <span
        className="job-progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
      >
        <i style={{ width: `${rounded}%` }} />
      </span>
    );
  return (
    <div className="upload-progress-row">
      <span>{label}</span>
      <div
        className="upload-progress-track"
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
      >
        <span
          className="upload-progress-fill"
          style={{ width: `${rounded}%` }}
        />
      </div>
      {showValue && <strong>{rounded}%</strong>}
    </div>
  );
}
