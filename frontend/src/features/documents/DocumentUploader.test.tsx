import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/server";
import { DocumentUploader } from "./DocumentUploader";

afterEach(() => vi.unstubAllGlobals());

function renderUploader(onComputeStarted?: (sessionId: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DocumentUploader disabled={false} onComputeStarted={onComputeStarted} />
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
  expect(
    within(folderCard).getByText(
      "1 PDF file contained · ready to upload and index",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Upload and index" }),
  ).toBeEnabled();
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

test("a multi-PDF folder never appears in the document picker card", async () => {
  server.use(http.get("/v1/document-schemas", () => HttpResponse.json([])));
  renderUploader();
  const pdfs = Array.from(
    { length: 10 },
    (_, index) =>
      new File(["pdf"], `clinical_progress_note_${index + 1}.pdf`, {
        type: "application/pdf",
      }),
  );

  fireEvent.change(screen.getByLabelText("Choose a folder of PDF files"), {
    target: { files: pdfs },
  });

  const documentCard = screen
    .getByLabelText("Choose individual documents")
    .closest("label")!;
  const folderCard = screen
    .getByLabelText("Choose a folder of PDF files")
    .closest("label")!;
  expect(await screen.findByRole("status")).toHaveTextContent(
    "10 PDFs selected",
  );
  expect(within(documentCard).getByText("Choose documents")).toBeVisible();
  expect(
    within(documentCard).queryByText("10 documents selected"),
  ).not.toBeInTheDocument();
  expect(within(folderCard).getByText("Selected PDF folder")).toBeVisible();
  expect(
    within(folderCard).getByText(
      "10 PDF files contained · ready to upload and index",
    ),
  ).toBeVisible();
  expect(folderCard).toHaveClass("selected");
  expect(documentCard).not.toHaveClass("selected");
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
    screen.getByRole("button", { name: "Upload and index" }),
  ).toBeDisabled();
});

test("uploads and starts indexing from the same button", async () => {
  const requestListeners = new Map<string, (event: ProgressEvent) => void>();
  const uploadListeners = new Map<string, (event: ProgressEvent) => void>();
  class FakeXMLHttpRequest {
    responseText =
      '{"type":"complete","job_id":"job-1","state":"held_for_compute","recommended_gpu_minutes":6}\n';
    status = 200;
    upload = {
      addEventListener: (
        type: string,
        listener: (event: ProgressEvent) => void,
      ) => uploadListeners.set(type, listener),
    };
    open() {}
    setRequestHeader() {}
    addEventListener(type: string, listener: (event: ProgressEvent) => void) {
      requestListeners.set(type, listener);
    }
    send() {
      uploadListeners.get("load")?.(new ProgressEvent("load"));
      requestListeners.get("load")?.(new ProgressEvent("load"));
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  server.use(
    http.get("/v1/document-schemas", () => HttpResponse.json([])),
    http.post("/v1/admin/compute-sessions", () =>
      HttpResponse.json({ session_id: "session-1" }, { status: 201 }),
    ),
    http.post("/v1/admin/compute-sessions/session-1/release", () =>
      HttpResponse.json({ session_id: "session-1" }),
    ),
  );
  const onComputeStarted = vi.fn();
  renderUploader(onComputeStarted);
  const document = new File(["invoice"], "invoice.pdf", {
    type: "application/pdf",
  });

  fireEvent.change(screen.getByLabelText("Choose individual documents"), {
    target: { files: [document] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload and index" }));

  expect(
    await screen.findByText("1 document is uploaded and indexing."),
  ).toBeVisible();
  expect(onComputeStarted).toHaveBeenCalledWith("session-1");
});
