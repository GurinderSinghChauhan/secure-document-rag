import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server";
import { DocumentUploader } from "./DocumentUploader";

function renderUploader() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DocumentUploader disabled={false} />
    </QueryClientProvider>,
  );
}

test("selecting a folder keeps PDFs and reports ignored non-PDF files", async () => {
  server.use(http.get("/v1/document-schemas", () => HttpResponse.json([])));
  renderUploader();
  const pdf = new File(["pdf"], "invoice.pdf", {
    type: "application/pdf",
  });
  const text = new File(["notes"], "notes.txt", { type: "text/plain" });

  fireEvent.change(screen.getByLabelText("Choose a folder of PDF files"), {
    target: { files: [pdf, text] },
  });

  expect(await screen.findByRole("status")).toHaveTextContent(
    "1 PDF selected. 1 non-PDF file was ignored.",
  );
  expect(screen.getByText("invoice.pdf")).toBeVisible();
  expect(screen.getByRole("button", { name: "Upload and hold" })).toBeEnabled();
});

test("selecting a folder with no PDFs leaves upload disabled", async () => {
  server.use(http.get("/v1/document-schemas", () => HttpResponse.json([])));
  renderUploader();
  const image = new File(["image"], "photo.png", { type: "image/png" });

  fireEvent.change(screen.getByLabelText("Choose a folder of PDF files"), {
    target: { files: [image] },
  });

  expect(await screen.findByRole("status")).toHaveTextContent(
    "0 PDFs selected. 1 non-PDF file was ignored.",
  );
  expect(
    screen.getByRole("button", { name: "Upload and hold" }),
  ).toBeDisabled();
});
