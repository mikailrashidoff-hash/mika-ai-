import { neon } from "@neondatabase/serverless";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type MemoryItem = {
  category: string;
  memory_key: string;
  memory_value: string;
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

  await sql`
    CREATE TABLE IF NOT EXISTS mika_memory (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'general',
      memory_key TEXT NOT NULL,
      memory_value TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(memory_key)
    )
  `;
}

async function getRecentMessages(): Promise<ChatMessage[]> {
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

async function getLongTermMemory(): Promise<MemoryItem[]> {
  const rows = await sql`
    SELECT category, memory_key, memory_value
    FROM mika_memory
    ORDER BY updated_at DESC
    LIMIT 100
  `;

  return rows.map((row) => ({
    category: String(row.category),
    memory_key: String(row.memory_key),
    memory_value: String(row.memory_value),
  }));
}

async function saveMessage(
  role: "user" | "assistant",
  text: string
) {
  await sql`
    INSERT INTO mika_messages (role, text)
    VALUES (${role}, ${text})
  `;
}

function extractOutputText(data: any): string {
  return (
    data?.output
      ?.flatMap((item: any) => item?.content || [])
      ?.find((item: any) => item?.type === "output_text")
      ?.text || ""
  );
}

function cleanJson(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function extractAndSaveMemories(
  userMessage: string,
  assistantReply: string
) {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          instructions: `
Ты — модуль памяти Mika AI.

Определи, есть ли в сообщении пользователя информация,
которую полезно помнить долго.

Сохраняй:
- имена клиентов, поставщиков и контактов;
- компании и заводы;
- цены и коммерческие договорённости;
- заказы и товары;
- рабочие предпочтения;
- постоянные инструкции пользователя;
- важные факты о проектах и бизнесе;
- информацию, которую пользователь прямо просит запомнить.

Не сохраняй:
- обычные приветствия;
- случайные фразы;
- временные мелочи;
- сам ответ ассистента как отдельный факт.

Верни ТОЛЬКО JSON без пояснений:

{
  "memories": [
    {
      "category": "business",
      "key": "короткий_понятный_ключ",
      "value": "сам важный факт"
    }
  ]
}

Если запоминать нечего:
{"memories":[]}

Максимум 3 факта за одно сообщение.
          `,
          input: `
Сообщение пользователя:
${userMessage}

Ответ Mika AI:
${assistantReply}
          `,
        }),
      }
    );

    if (!response.ok) return;

    const data = await response.json();
    const raw = extractOutputText(data);

    if (!raw) return;

    const parsed = JSON.parse(cleanJson(raw));

    if (!Array.isArray(parsed.memories)) return;

    for (const item of parsed.memories.slice(0, 3)) {
      if (
        typeof item?.key !== "string" ||
        typeof item?.value !== "string"
      ) {
        continue;
      }

      const category =
        typeof item.category === "string"
          ? item.category
          : "general";

      const key = item.key
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .slice(0, 120);

      const value = item.value.trim();

      if (!key || !value) continue;

      await sql`
        INSERT INTO mika_memory
          (category, memory_key, memory_value)
        VALUES
          (${category}, ${key}, ${value})
        ON CONFLICT (memory_key)
        DO UPDATE SET
          category = EXCLUDED.category,
          memory_value = EXCLUDED.memory_value,
          updated_at = NOW()
      `;
    }
  } catch (error) {
    console.error("MEMORY SAVE ERROR:", error);
  }
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

    const recentMessages = await getRecentMessages();
    const longTermMemory = await getLongTermMemory();

    const memoryText =
      longTermMemory.length > 0
        ? longTermMemory
            .map(
              (item) =>
                `- [${item.category}] ${item.memory_value}`
            )
            .join("\n")
        : "Пока долговременных фактов нет.";

    await saveMessage("user", currentUserMessage.text);

    const input = [
      ...recentMessages.map((item) => ({
        role: item.role,
        content: item.text,
      })),
      {
        role: "user" as const,
        content: currentUserMessage.text,
      },
    ];

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",

          instructions: `
Ты — Mika AI, персональный AI-ассистент Микаила.

Помогай Микаилу в работе, бизнесе и повседневных задачах.

Основной контекст:
- медицинское оборудование и расходные материалы;
- поставки из Китая;
- международная логистика;
- китайские заводы и поставщики;
- работа с клиентами;
- русский и китайский языки;
- при переводе на китайский всегда также давай обратный перевод на русский;
- коммерческие предложения;
- расчёты;
- рекламные и товарные тексты.

ДОЛГОВРЕМЕННАЯ ПАМЯТЬ MIKA AI:
${memoryText}

Используй эти факты естественно, когда они относятся к вопросу.
Не говори, что ты "прочитал базу данных".
Если новый факт противоречит старому, ориентируйся на более свежую информацию пользователя.

Стиль:
- по умолчанию отвечай по-русски;
- отвечай конкретно;
- не выдумывай цены, характеристики и договорённости;
- учитывай текущую переписку и долговременную память;
- называй себя Mika AI.
          `,

          input,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "OPENAI ERROR:",
        JSON.stringify(data)
      );

      return Response.json(
        {
          error:
            data?.error?.message ||
            "Ошибка при обращении к OpenAI",
        },
        { status: response.status }
      );
    }

    const reply = extractOutputText(data);

    if (!reply) {
      return Response.json(
        { error: "Mika AI не получил текст ответа" },
        { status: 500 }
      );
    }

    await saveMessage("assistant", reply);

    await extractAndSaveMemories(
      currentUserMessage.text,
      reply
    );

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
