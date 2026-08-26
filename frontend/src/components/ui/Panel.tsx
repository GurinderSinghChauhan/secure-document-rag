import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "./classNames";

interface PanelProps extends HTMLAttributes<HTMLElement> {
  labelledBy: string;
}

export function Panel({ className, labelledBy, ...props }: PanelProps) {
  return (
    <section
      {...props}
      className={classNames("admin-card", className)}
      aria-labelledby={labelledBy}
    />
  );
}

interface PanelHeaderProps {
  action?: ReactNode;
  kicker: string;
  step?: string;
  title: string;
  titleId: string;
}

export function PanelHeader({
  action,
  kicker,
  step,
  title,
  titleId,
}: PanelHeaderProps) {
  const heading = (
    <div className="panel-header">
      {step && <span className="step-number">{step}</span>}
      <div>
        <span className="section-kicker">{kicker}</span>
        <h2 id={titleId}>{title}</h2>
      </div>
    </div>
  );
  return action ? (
    <div className="compute-heading">
      {heading}
      {action}
    </div>
  ) : (
    <header className="panel-header">
      {step && <span className="step-number">{step}</span>}
      <div>
        <span className="section-kicker">{kicker}</span>
        <h2 id={titleId}>{title}</h2>
      </div>
    </header>
  );
}
