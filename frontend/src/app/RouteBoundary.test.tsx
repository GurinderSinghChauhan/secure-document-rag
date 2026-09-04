import { render, screen } from "@testing-library/react";
import { RouteBoundary } from "./RouteBoundary";

function BrokenRoute(): never {
  throw new Error("sensitive internal implementation detail");
}

test("does not expose route exception details to customers", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  render(
    <RouteBoundary>
      <BrokenRoute />
    </RouteBoundary>,
  );

  expect(
    screen.getByRole("heading", {
      name: "This section could not be displayed",
    }),
  ).toBeVisible();
  expect(
    screen.queryByText("sensitive internal implementation detail"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Reload application" }),
  ).toBeVisible();
});
