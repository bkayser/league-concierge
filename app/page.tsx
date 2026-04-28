"use client";

import { useEffect, useRef, useState } from "react";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 rounded-2xl bg-gray-100 w-fit">
      <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
      <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
      <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" />
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: DisplayMessage = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updated.map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = (await res.json()) as {
        reply?: string;
        sources?: string[];
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? `Request failed (HTTP ${res.status}). Please try again.`);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply ?? "",
          sources: data.sources ?? [],
        },
      ]);
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleClear() {
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="shrink-0 bg-green-700 text-white px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-5 h-5 opacity-80"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.804 21.644A6.707 6.707 0 0 0 6 21.75a6.721 6.721 0 0 0 3.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 0 1-.814 1.686.75.75 0 0 0 .44 1.223ZM8.25 10.875a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25ZM10.875 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Zm4.875-1.125a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z"
              clipRule="evenodd"
            />
          </svg>
          <h1 className="text-base font-semibold tracking-tight">OYSA Rules Assistant</h1>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="text-xs font-medium text-green-100 hover:text-white transition-colors"
          >
            New Chat
          </button>
        )}
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 pb-12">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-6 h-6 text-green-700"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.804 21.644A6.707 6.707 0 0 0 6 21.75a6.721 6.721 0 0 0 3.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 0 1-.814 1.686.75.75 0 0 0 .44 1.223ZM8.25 10.875a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25ZM10.875 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Zm4.875-1.125a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <p className="text-gray-800 font-medium">OYSA Rules Assistant</p>
              <p className="text-sm text-gray-500 mt-1 max-w-xs">
                Ask me anything about Oregon Youth Soccer Association rules and regulations.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`px-4 py-3 rounded-2xl max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-green-700 text-white rounded-br-sm"
                      : "bg-white text-gray-900 border border-gray-200 shadow-xs rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === "assistant" &&
                  msg.sources &&
                  msg.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[85%]">
                      {msg.sources.map((src) => (
                        <span
                          key={src}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="w-3 h-3 shrink-0"
                            aria-hidden="true"
                          >
                            <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h4.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 1 .439 1.061V12.5A1.5 1.5 0 0 1 11.5 14h-7A1.5 1.5 0 0 1 3 12.5v-9Z" />
                          </svg>
                          {src}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
            ))}

            {loading && (
              <div className="flex items-start">
                <TypingIndicator />
              </div>
            )}

            {error && (
              <div className="flex justify-center">
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
                  {error}
                </p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
        <form
          onSubmit={handleSubmit}
          className="max-w-2xl mx-auto flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Ask about OYSA rules…"
            autoComplete="off"
            className="flex-1 rounded-full border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-green-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-green-600 disabled:opacity-60 transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="shrink-0 w-10 h-10 rounded-full bg-green-700 text-white flex items-center justify-center hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.115A28.897 28.897 0 0 0 3.105 2.288Z" />
            </svg>
          </button>
        </form>
        <p className="max-w-2xl mx-auto mt-1.5 text-center text-[11px] text-gray-400">
          Answers are based on OYSA official documents. Always verify with your league administrator.
        </p>
      </div>
    </div>
  );
}
