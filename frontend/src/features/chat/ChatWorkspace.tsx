import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "../../api/types";
import { chatKeys, getChat, listChats, streamAnswer } from "./api";
import { useVoiceInput } from "./useVoiceInput";
import { AppShell } from "../../components/layout/AppShell";
import { Button, EmptyState, Textarea } from "../../components/ui";

const suggestions = [
  "Summarize the key obligations in the indexed documents.",
  "What deadlines or renewal dates are mentioned?",
  "Identify any risks, exceptions, or unresolved items.",
];

type DisplayMessage = Pick<ChatMessage, "role" | "content"> & {
  error?: boolean;
};

export function ChatWorkspace() {
  const queryClient = useQueryClient();
  const chats = useQuery({ queryKey: chatKeys.all, queryFn: listChats });
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [composerStatus, setComposerStatus] = useState("Ready to search");
  const logRef = useRef<HTMLDivElement>(null);
  const changeQuestion = useCallback((value: string) => setQuestion(value), []);
  const voice = useVoiceInput(
    question,
    changeQuestion,
    __VOICE_INPUT_ENABLED__,
  );

  async function load(chatId: string) {
    if (busy) return;
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: chatKeys.detail(chatId),
        queryFn: () => getChat(chatId),
      });
      setMessages(detail.messages);
      setActiveChatId(detail.chat_id);
    } catch (error) {
      append({
        role: "assistant",
        content:
          error instanceof Error ? error.message : "Unable to load this chat.",
        error: true,
      });
    }
  }

  function append(message: DisplayMessage) {
    setMessages((current) => [...current, message]);
    requestAnimationFrame(() => {
      if (logRef.current)
        logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = question.trim();
    if (prompt.length < 3 || busy) return;
    append({ role: "user", content: prompt });
    setQuestion("");
    setBusy(true);
    setComposerStatus("Searching authorized documents…");
    voice.stop();
    let answer = "";
    try {
      await streamAnswer(prompt, activeChatId, (streamEvent) => {
        if (streamEvent.type === "chat") setActiveChatId(streamEvent.chat_id);
        if (streamEvent.type === "delta") {
          answer += streamEvent.text;
          setComposerStatus("Generating answer…");
          setMessages((current) => {
            const last = current.at(-1);
            if (last?.role === "assistant" && !last.error)
              return [
                ...current.slice(0, -1),
                { role: "assistant", content: answer },
              ];
            return [...current, { role: "assistant", content: answer }];
          });
        }
      });
      if (!answer) throw new Error("The model returned an empty answer.");
      await queryClient.invalidateQueries({ queryKey: chatKeys.all });
    } catch (error) {
      append({
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Unable to connect to the RAG service.",
        error: true,
      });
    } finally {
      setBusy(false);
      setComposerStatus("Ready to search");
    }
  }

  const sidebar = (
    <section className="chat-history" aria-labelledby="chat-history-title">
      <div className="chat-history-header">
        <span id="chat-history-title">Recent chats</span>
        <Button
          type="button"
          aria-label="Start a new chat"
          title="New chat"
          disabled={busy}
          onClick={() => {
            setMessages([]);
            setActiveChatId(null);
          }}
        >
          +
        </Button>
      </div>
      <div className="chat-history-list" aria-live="polite">
        {chats.data?.map((chat) => (
          <Button
            className={`chat-history-item ${activeChatId === chat.chat_id ? "active" : ""}`}
            type="button"
            key={chat.chat_id}
            disabled={busy}
            onClick={() => void load(chat.chat_id)}
          >
            <strong>{chat.title}</strong>
            <time dateTime={chat.updated_at}>
              {new Date(chat.updated_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </time>
          </Button>
        ))}
      </div>
      {!chats.data?.length && (
        <p className="chat-history-empty">
          {chats.isPending
            ? "Loading chats…"
            : chats.error instanceof Error
              ? chats.error.message
              : "No saved chats yet."}
        </p>
      )}
    </section>
  );
  return (
    <AppShell section="Ask" sidebar={sidebar}>
      <main id="main-content" className="content">
        <section
          className="assistant-workspace"
          aria-labelledby="assistant-title"
        >
          <header className="assistant-header">
            <div>
              <span className="section-kicker">Authorized knowledge</span>
              <h1 id="assistant-title">Ask the operational record</h1>
              <p>
                Search only the documents and context your role is allowed to
                access, then turn them into grounded answers for action.
              </p>
            </div>
            <div className="scope-label">
              ⓘ Access controls apply to every search
            </div>
          </header>
          <div
            ref={logRef}
            className="chat-log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {!messages.length && (
              <EmptyState
                icon="✓"
                title="What do you need to verify?"
                description="Ask a focused question and the assistant will search only the documents available to your tenant, role, and policy scope."
              >
                <div
                  className="prompt-suggestions"
                  aria-label="Example questions"
                >
                  {suggestions.map((prompt) => (
                    <Button
                      className="prompt-suggestion"
                      type="button"
                      key={prompt}
                      onClick={() => setQuestion(prompt)}
                    >
                      <span>{prompt}</span>
                      <span aria-hidden="true">›</span>
                    </Button>
                  ))}
                </div>
              </EmptyState>
            )}
            {messages.map((message, index) => (
              <article
                className={`message ${message.error ? "error" : message.role}-message`}
                key={`${message.role}-${index}`}
              >
                <span className="message-avatar" aria-hidden="true">
                  {message.error ? "!" : message.role === "user" ? "You" : "AI"}
                </span>
                <div className="message-body">
                  <p className="message-meta">
                    <strong>
                      {message.error
                        ? "Request failed"
                        : message.role === "user"
                          ? "You"
                          : "Document assistant"}
                    </strong>
                  </p>
                  <div className="message-content">
                    <p>{message.content}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <form className="composer" onSubmit={(event) => void submit(event)}>
            <label className="sr-only" htmlFor="question">
              Question
            </label>
            <Textarea
              id="question"
              rows={2}
              minLength={3}
              maxLength={8000}
              placeholder="Ask a question about your documents…"
              required
              value={question}
              disabled={busy}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="composer-footer">
              <span role="status">
                <span className="ready-dot" aria-hidden="true" />{" "}
                {busy ? composerStatus : voice.status}
              </span>
              <div className="composer-actions">
                {voice.available && (
                  <Button
                    className={`voice-input-button ${voice.listening ? "listening" : ""}`}
                    type="button"
                    aria-label={
                      voice.listening ? "Stop voice input" : "Start voice input"
                    }
                    aria-pressed={voice.listening}
                    disabled={busy}
                    onClick={voice.toggle}
                  >
                    🎙
                  </Button>
                )}
                <Button
                  className="send-button"
                  type="submit"
                  disabled={busy || question.trim().length < 3}
                >
                  <span>{busy ? "Searching…" : "Send"}</span>
                  <span aria-hidden="true">➤</span>
                </Button>
              </div>
            </div>
          </form>
          <p className="assistant-disclaimer">
            AI responses can be incomplete. Verify consequential decisions
            against the original document.
          </p>
        </section>
      </main>
    </AppShell>
  );
}
