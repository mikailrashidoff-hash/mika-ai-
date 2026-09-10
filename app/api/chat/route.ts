import { neon } from "@neondatabase/serverless";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

const sql = neon(process.env.DATABASE_URL!);

async function prepareDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS mika_messages (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function getMemory(): Promise<ChatMessage[]> {
  const rows = await sql`
    SELECT role, text
    FROM mika_messages
    ORDER BY id DESC
    LIMIT 40
  `;

  return rows
    .reverse()
    .filter(
      (row) =>
        (row.role === "user" || row.role === "assistant") &&
        typeof row.text === "string"
    )
    .map((row) => ({
      role: row.role as "user" | "assistant",
      text: row.text as string,
    }));
}

async function saveMessage(role: "user" | "assistant", text: string) {
  await sql`
    INSERT INTO mika_messages (role, text)
    VALUES (${role}, ${text})
  `;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    let messages: ChatMessage[] = [];

    if (Array.isArray(body.messages)) {
      messages = body.messages;
    } else if (typeof body.message === "string") {
      messages = [
        {
          role: "user",
          text: body.message,
        },
      ];
    }

    if (messages.length === 0) {
      return Response.json(
        { error: "Сообщения не переданы" },
        { status: 400 }
      );
    }

    const currentUserMessage = [...messages]
      .reverse()
      .find(
        (item) =>
          item &&
          item.role === "user" &&
          typeof item.text === "string" &&
          item.text.trim()
      );

    if (!currentUserMessage) {
      return Response.json(
        { error: "Сообщение пользователя не найдено" },
        { status: 400 }
      );
    }

    await prepareDatabase();

    const memory = await getMemory();

    await saveMessage("user", currentUserMessage.text);

    const input = [
      ...memory.map((item) => ({
        role: item.role,
        content: item.text,
      })),
      {
        role: "user" as const,
        content: currentUserMessage.text,
      },
    ];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",

        instructions: `
Ты — Mika AI, персональный AI-ассистент Микаила.

Твоя задача — помогать Микаилу в работе, бизнесе и повседневных задачах.

Контекст:
- медицинское оборудование и расходные материалы;
- поставки из Китая и международная логистика;
- работа с китайскими заводами, поставщиками и клиентами;
- переводы между русским и китайским;
- при переводе на китайский всегда также давай обратный перевод на русский;
- помогай с деловыми сообщениями, коммерческими предложениями;
- помогай с расчётами, логистикой, рекламными и товарными текстами.

Память:
- используй историю предыдущих сообщений, которую тебе передают;
- помни факты и договорённости из прошлой переписки;
- если Микаил ссылается на предыдущий разговор, используй сохранённый контекст;
- не утверждай, что чего-то не помнишь, если эта информация есть в истории.

Стиль:
- по умолчанию отвечай по-русски;
- отвечай конкретно и понятно;
- не выдумывай цены, характеристики и договорённости;
- учитывай контекст текущей и предыдущей переписки;
- называй себя Mika AI.
        `,

        input,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OPENAI ERROR:", JSON.stringify(data));

      return Response.json(
        {
          error:
            data?.error?.message ||
            "Ошибка при обращении к OpenAI",
        },
        { status: response.status }
      );
    }

    const reply =
      data?.output
        ?.flatMap((item: any) => item?.content || [])
        ?.find((item: any) => item?.type === "output_text")
        ?.text || "";

    if (!reply) {
      return Response.json(
        { error: "Mika AI не получил текст ответа" },
        { status: 500 }
      );
    }

    await saveMessage("assistant", reply);

    return Response.json({ reply });
  } catch (error) {
    console.error("MIKA AI SERVER ERROR:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Ошибка сервера Mika AI",
      },
      { status: 500 }
    );
  }
}
