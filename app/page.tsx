"use client";

import { useState } from "react";

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Привет! Я Mika AI. Напиши мне сообщение.",
    },
  ]);

  function sendMessage() {
    if (!message.trim()) return;

    setMessages([
      ...messages,
      { role: "user", text: message },
      {
        role: "assistant",
        text: "Пока я работаю в тестовом режиме. Следующим шагом подключим настоящий AI.",
      },
    ]);

    setMessage("");
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
        <h1 style={{ marginBottom: "4px" }}>Mika AI</h1>
        <p style={{ color: "#666", marginTop: 0 }}>
          Персональный AI-ассистент
        </p>

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
                }}
              >
                {item.text}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
            placeholder="Напишите сообщение..."
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
            style={{
              border: "none",
              borderRadius: "14px",
              padding: "14px 18px",
              background: "#111",
              color: "white",
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            Отправить
          </button>
        </div>
      </div>
    </main>
  );
}
