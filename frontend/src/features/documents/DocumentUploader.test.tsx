import { fireEvent, render, screen, within } from "@testing-library/react";
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
  expect(screen.getByLabelText("Document type")).toHaveValue("");
  expect(
    screen.getByText(/Auto-detect classifies each document independently/),
  ).toBeVisible();
  expect(screen.queryByText("Processing")).not.toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Auto-detect document type" }),
  ).toBeVisible();
  const pdf = new File(["pdf"], "invoice.pdf", {
    type: "application/pdf",
  });
  Object.defineProperty(pdf, "webkitRelativePath", {
    value: "Claims/invoice.pdf",
  });
  const text = new File(["notes"], "notes.txt", { type: "text/plain" });

  fireEvent.change(screen.getByLabelText("Choose a folder of PDF files"), {
    target: { files: [pdf, text] },
  });

  expect(await screen.findByRole("status")).toHaveTextContent(
    "1 PDF selected. 1 non-PDF file was ignored.",
  );
  const documentCard = screen
    .getByLabelText("Choose individual documents")
    .closest("label")!;
  const folderCard = screen
    .getByLabelText("Choose a folder of PDF files")
    .closest("label")!;
  expect(within(documentCard).getByText("Choose documents")).toBeVisible();
  expect(within(documentCard).queryByText("Claims")).not.toBeInTheDocument();
  expect(within(folderCard).getByText("Claims")).toBeVisible();
  expect(within(folderCard).getByText(/1 PDF ready/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Upload and hold" })).toBeEnabled();
});

test("individual files stay in the document selection card", () => {
  server.use(http.get("/v1/document-schemas", () => HttpResponse.json([])));
  renderUploader();
  const document = new File(["notes"], "notes.txt", { type: "text/plain" });

  fireEvent.change(screen.getByLabelText("Choose individual documents"), {
    target: { files: [document] },
  });

  const documentCard = screen
    .getByLabelText("Choose individual documents")
    .closest("label")!;
  const folderCard = screen
    .getByLabelText("Choose a folder of PDF files")
    .closest("label")!;
  expect(within(documentCard).getByText("notes.txt")).toBeVisible();
  expect(within(folderCard).getByText("Choose a PDF folder")).toBeVisible();
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
    screen.getByRole("button", { name: "Choose documents to upload" }),
  ).toBeDisabled();
});
