import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Input,
  Panel,
  PanelHeader,
  ProgressBar,
} from ".";

describe("shared UI components", () => {
  it("applies button variants and blocks duplicate actions while busy", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" busy busyLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("primary-button");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps form labels and validation guidance semantic", () => {
    render(
      <FormField label="Organization" hint="Use the registered name.">
        <Input name="organization" required />
      </FormField>,
    );

    expect(screen.getByLabelText("Organization")).toBeRequired();
    expect(screen.getByText("Use the registered name.")).toBeVisible();
  });

  it("connects panel headings and clamps progress values", () => {
    render(
      <Panel labelledBy="queue-title">
        <PanelHeader
          kicker="Processing"
          title="Compute queue"
          titleId="queue-title"
        />
        <ProgressBar label="Document indexing" value={106} showValue />
      </Panel>,
    );

    expect(screen.getByRole("region", { name: "Compute queue" })).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Document indexing progress" }),
    ).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("renders reusable empty-state and badge semantics", () => {
    render(
      <EmptyState title="No documents" description="Upload a document.">
        <Badge variant="active">Ready</Badge>
      </EmptyState>,
    );

    expect(screen.getByRole("heading", { name: "No documents" })).toBeVisible();
    expect(screen.getByText("Ready")).toHaveClass("status-pill", "active");
  });
});
