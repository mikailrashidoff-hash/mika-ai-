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

type BusinessMemory = {
  memory_type: string;
  name: string;
  details: string;
  amount: string | null;
  currency: string | null;
  status: string | null;
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

  await sql`
    CREATE TABLE IF NOT EXISTS mika_business_memory (
      id SERIAL PRIMARY KEY,
      memory_type TEXT NOT NULL,
      name TEXT NOT NULL,
      details TEXT NOT NULL,
      amount NUMERIC,
      currency TEXT,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
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
      text: String(row.text),
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

async function getBusinessMemory(): Promise<BusinessMemory[]> {
  const rows = await sql`
    SELECT
      memory_type,
      name,
      details,
      amount,
      currency,
      status
    FROM mika_business_memory
    ORDER BY updated_at DESC
    LIMIT 100
  `;

  return rows.map((row) => ({
    memory_type: String(row.memory_type),
    name: String(row.name),
    details: String(row.details),
    amount: row.amount !== null ? String(row.amount) : null,
    currency: row.currency !== null ? String(row.currency) : null,
    status: row.status !== null ? String(row.status) : null,
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
Ты — модуль долговременной памяти Mika AI.

Определи, есть ли в сообщении пользователя информация,
которую полезно помнить долго.

Сохраняй:
- постоянные предпочтения;
- важные факты;
- инструкции пользователя;
- информацию о проектах;
- информацию, которую пользователь прямо просит запомнить.

Не сохраняй обычные приветствия и случайные временные фразы.

Верни ТОЛЬКО JSON:

{
  "memories": [
    {
      "category": "general",
      "key": "короткий_ключ",
      "value": "важный факт"
    }
  ]
}

Если запоминать нечего:
{"memories":[]}

Максимум 3 факта.
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

async function extractAndSaveBusinessMemory(
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
Ты — бизнес-модуль памяти Mika AI.

Извлекай только конкретные рабочие данные.

Допустимые типы:
- client
- supplier
- product
- price
- order
- agreement

Примеры того, что нужно сохранять:
- имя клиента и что ему нужно;
- имя поставщика или завода;
- название товара;
- закупочная или продажная цена;
- валюта;
- заказ;
- договорённость;
- статус заказа или переговоров.

Ничего не выдумывай.
Если цена или валюта не указаны — ставь null.

Верни ТОЛЬКО JSON:

{
  "items": [
    {
      "memory_type": "client",
      "name": "Имя или название",
      "details": "Что важно знать",
      "amount": null,
      "currency": null,
      "status": null
    }
  ]
}

Если бизнес-данных нет:
{"items":[]}

Максимум 5 записей.
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

    if (!Array.isArray(parsed.items)) return;

    for (const item of parsed.items.slice(0, 5)) {
      if (
        typeof item?.memory_type !== "string" ||
        typeof item?.name !== "string" ||
        typeof item?.details !== "string"
      ) {
        continue;
      }

      const memoryType = item.memory_type.trim();
      const name = item.name.trim();
      const details = item.details.trim();

      if (!memoryType || !name || !details) continue;

      const allowedTypes = [
        "client",
        "supplier",
        "product",
        "price",
        "order",
        "agreement",
      ];

      if (!allowedTypes.includes(memoryType)) continue;

      const amount =
        typeof item.amount === "number"
          ? item.amount
          : typeof item.amount === "string" &&
              item.amount.trim() !== "" &&
              !Number.isNaN(Number(item.amount))
            ? Number(item.amount)
            : null;

      const currency =
        typeof item.currency === "string" &&
        item.currency.trim()
          ? item.currency.trim()
          : null;

      const status =
        typeof item.status === "string" &&
        item.status.trim()
          ? item.status.trim()
          : null;

      await sql`
        INSERT INTO mika_business_memory
          (
            memory_type,
            name,
            details,
            amount,
            currency,
            status
          )
        SELECT
          ${memoryType},
          ${name},
          ${details},
          ${amount},
          ${currency},
          ${status}
        WHERE NOT EXISTS (
          SELECT 1
          FROM mika_business_memory
          WHERE memory_type = ${memoryType}
            AND name = ${name}
            AND details = ${details}
        )
      `;
    }
  } catch (error) {
    console.error("BUSINESS MEMORY ERROR:", error);
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

    const [
      recentMessages,
      longTermMemory,
      businessMemory,
    ] = await Promise.all([
      getRecentMessages(),
      getLongTermMemory(),
      getBusinessMemory(),
    ]);

    const memoryText =
      longTermMemory.length > 0
        ? longTermMemory
            .map(
              (item) =>
                `- [${item.category}] ${item.memory_value}`
            )
            .join("\n")
        : "Пока долговременных фактов нет.";

    const businessText =
      businessMemory.length > 0
        ? businessMemory
            .map((item) => {
              const price =
                item.amount && item.currency
                  ? ` | сумма: ${item.amount} ${item.currency}`
                  : "";

              const status = item.status
                ? ` | статус: ${item.status}`
                : "";

              return `- [${item.memory_type}] ${item.name}: ${item.details}${price}${status}`;
            })
            .join("\n")
        : "Пока сохранённых бизнес-данных нет.";

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
- медицинское оборудование;
- медицинские расходные материалы;
- поставки из Китая;
- международная логистика;
- китайские заводы и поставщики;
- работа с клиентами;
- русский и китайский языки;
- при переводе на китайский всегда также давай обратный перевод на русский;
- коммерческие предложения;
- расчёты;
- реклама и товарные тексты.

ДОЛГОВРЕМЕННАЯ ПАМЯТЬ:
${memoryText}

БИЗНЕС-ПАМЯТЬ:
${businessText}

Используй бизнес-память при вопросах о:
- клиентах;
- поставщиках;
- заводах;
- товарах;
- ценах;
- заказах;
- договорённостях.

Не выдумывай отсутствующие данные.
Если есть несколько цен одного товара, учитывай контекст и не утверждай, что одна из них актуальная, если это не ясно.
Если пользователь сообщает новые данные, ориентируйся прежде всего на более свежую информацию.

Стиль:
- по умолчанию отвечай по-русски;
- отвечай конкретно и понятно;
- учитывай текущую переписку и память;
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

    await Promise.all([
      extractAndSaveMemories(
        currentUserMessage.text,
        reply
      ),
      extractAndSaveBusinessMemory(
        currentUserMessage.text,
        reply
      ),
    ]);

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
