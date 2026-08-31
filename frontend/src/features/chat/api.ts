import { api, errorMessage } from "../../api/client";
import type { ChatDetail, ChatSummary } from "../../api/types";

export const chatKeys = {
  all: ["chats"] as const,
  detail: (id: string) => ["chats", id] as const,
};

export function listChats() {
  return api.json<ChatSummary[]>(
    "/v1/chats",
    {},
    "Unable to load chat history.",
  );
}

export function getChat(chatId: string) {
  return api.json<ChatDetail>(
    `/v1/chats/${encodeURIComponent(chatId)}`,
    {},
    "Unable to load this chat.",
  );
}

export async function streamAnswer(
  question: string,
  chatId: string | null,
  onEvent: (event: StreamEvent) => void,
) {
  const response = await api.request("/v1/query/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, ...(chatId ? { chat_id: chatId } : {}) }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    throw new Error(errorMessage(body, "Unable to complete the request."));
  }
  if (!response.body)
    throw new Error("Streaming is not supported by this browser.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      const event: StreamEvent = JSON.parse(line) as StreamEvent;
      if (event.type === "error")
        throw new Error(event.detail || "Unable to generate an answer.");
      onEvent(event);
    }
    if (done) break;
  }
}

export type StreamEvent =
  | { type: "chat"; chat_id: string }
  | { type: "delta"; text: string }
  | { type: "error"; detail?: string };
