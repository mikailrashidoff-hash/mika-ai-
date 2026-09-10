"use client";

import { useEffect, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

const STORAGE_KEY = "mika-ai-chat";

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Привет! Я Mika AI. Напиши мне сообщение.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // Если сохранённая история повреждена, просто начинаем новый чат.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Если браузер не разрешил сохранение, чат всё равно продолжит работать.
    }
  }, [messages, loaded]);

  async function sendMessage() {
    const text = message.trim();

    if (!text || loading) return;

    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: "user", text },
    ];

    setMessages(updatedMessages);
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Ошибка запроса");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply || "Я не получил ответ.",
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Не удалось получить ответ. Попробуй ещё раз.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    const freshChat: ChatMessage[] = [
      {
        role: "assistant",
        text: "Привет! Я Mika AI. Начинаем новый диалог.",
      },
    ];

    setMessages(freshChat);

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f7fb",
        padding: "20px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "700px",
          margin: "0 auto",
          background: "white",
          borderRadius: "24px",
          padding: "20px",
          boxShadow: "0 10px 35px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "12px",
          }}
        >
          <div>
            <h1 style={{ marginBottom: "4px" }}>Mika AI</h1>
            <p style={{ color: "#666", marginTop: 0 }}>
              Персональный AI-ассистент
            </p>
          </div>

          <button
            onClick={clearChat}
            style={{
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "9px 12px",
              background: "white",
              cursor: "pointer",
            }}
          >
            Новый чат
          </button>
        </div>

        <div
          style={{
            minHeight: "420px",
            marginTop: "25px",
            marginBottom: "20px",
          }}
        >
          {messages.map((item, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                justifyContent:
                  item.role === "user" ? "flex-end" : "flex-start",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "12px 15px",
                  borderRadius: "18px",
                  background:
                    item.role === "user" ? "#111" : "#eef1f6",
                  color: item.role === "user" ? "white" : "#111",
                  whiteSpace: "pre-wrap",
                }}
              >
                {item.text}
              </div>
            </div>
          ))}

          {loading && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-start",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  padding: "12px 15px",
                  borderRadius: "18px",
                  background: "#eef1f6",
                  color: "#666",
                }}
              >
                Mika AI думает...
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendMessage();
              }
            }}
            placeholder="Напишите сообщение..."
            disabled={loading}
            style={{
              flex: 1,
              padding: "14px",
              borderRadius: "14px",
              border: "1px solid #ddd",
              fontSize: "16px",
            }}
          />

          <button
            onClick={sendMessage}
            disabled={loading}
            style={{
              border: "none",
              borderRadius: "14px",
              padding: "14px 18px",
              background: "#111",
              color: "white",
              fontSize: "16px",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "..." : "Отправить"}
          </button>
        </div>
      </div>
    </main>
  );
}
