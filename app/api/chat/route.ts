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
  id?: number;
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

async function saveMessage(
  role: "user" | "assistant",
  text: string
) {
  await sql`
    INSERT INTO mika_messages (role, text)
    VALUES (${role}, ${text})
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
        (row.role === "user" ||
          row.role === "assistant") &&
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
      id,
      memory_type,
      name,
      details,
      amount,
      currency,
      status
    FROM mika_business_memory
    ORDER BY updated_at DESC
    LIMIT 150
  `;

  return rows.map((row) => ({
    id: Number(row.id),
    memory_type: String(row.memory_type),
    name: String(row.name),
    details: String(row.details),
    amount:
      row.amount !== null ? String(row.amount) : null,
    currency:
      row.currency !== null
        ? String(row.currency)
        : null,
    status:
      row.status !== null ? String(row.status) : null,
  }));
}

function extractOutputText(data: any): string {
  return (
    data?.output
      ?.flatMap((item: any) => item?.content || [])
      ?.find(
        (item: any) => item?.type === "output_text"
      )?.text || ""
  );
}

function cleanJson(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/* ============================= */
/* CRM-КОМАНДЫ                    */
/* ============================= */

async function detectCRMCommand(message: string) {
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
Ты определяешь CRM-команды Mika AI.

Доступные действия:

list_clients
list_suppliers
list_products
list_prices
list_orders
lookup
update_status
delete_price
none

Примеры:

"Покажи всех клиентов"
→ list_clients

"Какие у меня поставщики?"
→ list_suppliers

"Какие заказы сейчас есть?"
→ list_orders

"Что ты помнишь про Николь?"
→ lookup

"Что по Артёму?"
→ lookup

"Какие цены по сканерам?"
→ list_prices

"Обнови статус заказа Артёма на оплачено"
→ update_status

"Удали старую цену сканера"
→ delete_price

Обычный разговор:
→ none

Верни ТОЛЬКО JSON:

{
  "action": "none",
  "query": null,
  "status": null
}

Для поиска положи имя или товар в query.
Для update_status положи новый статус в status.
          `,

          input: message,
        }),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const raw = extractOutputText(data);

    if (!raw) return null;

    return JSON.parse(cleanJson(raw));
  } catch {
    return null;
  }
}

function formatBusinessRows(rows: any[]) {
  if (!rows.length) {
    return "Ничего не найдено.";
  }

  return rows
    .map((row, index) => {
      const amount =
        row.amount !== null &&
        row.amount !== undefined
          ? ` | Цена: ${row.amount}${
              row.currency
                ? ` ${row.currency}`
                : ""
            }`
          : "";

      const status = row.status
        ? ` | Статус: ${row.status}`
        : "";

      return `${index + 1}. ${row.name} — ${
        row.details
      }${amount}${status}`;
    })
    .join("\n");
}

async function executeCRMCommand(command: any) {
  if (!command?.action) return null;

  if (command.action === "list_clients") {
    const rows = await sql`
      SELECT *
      FROM mika_business_memory
      WHERE memory_type = 'client'
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    return `Клиенты:\n${formatBusinessRows(rows)}`;
  }

  if (command.action === "list_suppliers") {
    const rows = await sql`
      SELECT *
      FROM mika_business_memory
      WHERE memory_type = 'supplier'
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    return `Поставщики:\n${formatBusinessRows(
      rows
    )}`;
  }

  if (command.action === "list_products") {
    const rows = await sql`
      SELECT *
      FROM mika_business_memory
      WHERE memory_type = 'product'
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    return `Товары:\n${formatBusinessRows(rows)}`;
  }

  if (command.action === "list_prices") {
    const q =
      typeof command.query === "string"
        ? command.query.trim()
        : "";

    let rows;

    if (q) {
      const pattern = `%${q}%`;

      rows = await sql`
        SELECT *
        FROM mika_business_memory
        WHERE memory_type = 'price'
          AND (
            name ILIKE ${pattern}
            OR details ILIKE ${pattern}
          )
        ORDER BY updated_at DESC
        LIMIT 100
      `;
    } else {
      rows = await sql`
        SELECT *
        FROM mika_business_memory
        WHERE memory_type = 'price'
        ORDER BY updated_at DESC
        LIMIT 100
      `;
    }

    if (!rows.length) return null;

    return `Сохранённые цены:\n${formatBusinessRows(
      rows
    )}`;
  }

  if (command.action === "list_orders") {
    const rows = await sql`
      SELECT *
      FROM mika_business_memory
      WHERE memory_type = 'order'
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    return `Заказы:\n${formatBusinessRows(rows)}`;
  }

  if (command.action === "lookup") {
    const q =
      typeof command.query === "string"
        ? command.query.trim()
        : "";

    if (!q) return null;

    const words = q
      .split(/[\s,;]+/i)
      .map((word: string) => word.trim())
      .filter(
        (word: string) =>
          word.length >= 3 &&
          !["про", "что", "помнишь", "помню", "или"].includes(
            word.toLowerCase()
          )
      );

    let rows: any[] = [];

    for (const word of words) {
      const pattern = `%${word}%`;

      const found = await sql`
        SELECT *
        FROM mika_business_memory
        WHERE
          name ILIKE ${pattern}
          OR details ILIKE ${pattern}
        ORDER BY updated_at DESC
        LIMIT 30
      `;

      rows.push(...found);
    }

    const uniqueRows = Array.from(
      new Map(
        rows.map((row: any) => [row.id, row])
      ).values()
    );

    if (uniqueRows.length === 0) {
      return null;
    }

    return `Вот что я помню по запросу «${q}»:\n${formatBusinessRows(
      uniqueRows
    )}`;
  }

  if (command.action === "update_status") {
    const q =
      typeof command.query === "string"
        ? command.query.trim()
        : "";

    const newStatus =
      typeof command.status === "string"
        ? command.status.trim()
        : "";

    if (!q || !newStatus) {
      return "Не смог определить заказ или новый статус.";
    }

    const pattern = `%${q}%`;

    const rows = await sql`
      UPDATE mika_business_memory
      SET
        status = ${newStatus},
        updated_at = NOW()
      WHERE
        memory_type IN ('order', 'client', 'agreement')
        AND (
          name ILIKE ${pattern}
          OR details ILIKE ${pattern}
        )
      RETURNING *
    `;

    if (!rows.length) {
      return null;
    }

    return `Готово. Статус обновлён на «${newStatus}».\n${formatBusinessRows(
      rows
    )}`;
  }

  if (command.action === "delete_price") {
    const q =
      typeof command.query === "string"
        ? command.query.trim()
        : "";

    if (!q) {
      return "Уточни, цену какого товара нужно удалить.";
    }

    const pattern = `%${q}%`;

    const rows = await sql`
      DELETE FROM mika_business_memory
      WHERE memory_type = 'price'
        AND (
          name ILIKE ${pattern}
          OR details ILIKE ${pattern}
        )
      RETURNING *
    `;

    if (!rows.length) {
      return null;
    }

    return `Удалил ${
      rows.length
    } записей с ценой по запросу «${q}».`;
  }

  return null;
}

/* ============================= */
/* ОБЫЧНАЯ ДОЛГОВРЕМЕННАЯ ПАМЯТЬ */
/* ============================= */

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

Сохраняй:
- постоянные предпочтения;
- инструкции пользователя;
- важные факты;
- проекты;
- людей и контакты;
- информацию, которую пользователь прямо просит запомнить.

Не сохраняй обычные приветствия и случайные мелочи.

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

Если нечего сохранять:
{"memories":[]}

Максимум 3 факта.
          `,

          input: `
Пользователь:
${userMessage}

Mika AI:
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

/* ============================= */
/* БИЗНЕС-ПАМЯТЬ                  */
/* ============================= */

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

Извлекай конкретные рабочие данные.

Допустимые типы:
client
supplier
product
price
order
agreement

Сохраняй:
- клиентов;
- поставщиков;
- заводы;
- товары;
- цены;
- валюту;
- заказы;
- договорённости;
- статусы.

Ничего не выдумывай.

Верни ТОЛЬКО JSON:

{
  "items": [
    {
      "memory_type": "client",
      "name": "Название",
      "details": "Детали",
      "amount": null,
      "currency": null,
      "status": null
    }
  ]
}

Если данных нет:
{"items":[]}

Максимум 5 записей.
          `,

          input: `
Пользователь:
${userMessage}

Mika AI:
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

    const allowedTypes = [
      "client",
      "supplier",
      "product",
      "price",
      "order",
      "agreement",
    ];

    for (const item of parsed.items.slice(0, 5)) {
      if (
        typeof item?.memory_type !== "string" ||
        typeof item?.name !== "string" ||
        typeof item?.details !== "string"
      ) {
        continue;
      }

      const memoryType =
        item.memory_type.trim().toLowerCase();

      const name = item.name.trim();
      const details = item.details.trim();

      if (!allowedTypes.includes(memoryType))
        continue;

      if (!name || !details) continue;

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
    console.error(
      "BUSINESS MEMORY ERROR:",
      error
    );
  }
}

/* ============================= */
/* ГЛАВНЫЙ CHAT API               */
/* ============================= */

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

    if (!messages.length) {
      return Response.json(
        { error: "Сообщения не переданы" },
        { status: 400 }
      );
    }

    const currentUserMessage = [...messages]
      .reverse()
      .find(
        (item) =>
          item?.role === "user" &&
          typeof item.text === "string" &&
          item.text.trim()
      );

    if (!currentUserMessage) {
      return Response.json(
        {
          error:
            "Сообщение пользователя не найдено",
        },
        { status: 400 }
      );
    }

    await prepareDatabase();

    await saveMessage(
      "user",
      currentUserMessage.text
    );

    const crmCommand = await detectCRMCommand(
      currentUserMessage.text
    );

    if (
      crmCommand &&
      crmCommand.action !== "none"
    ) {
      const crmReply =
        await executeCRMCommand(crmCommand);

      if (crmReply) {
        await saveMessage("assistant", crmReply);

        return Response.json({
          reply: crmReply,
        });
      }
    }

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
        : "Пока долговременной памяти нет.";

    const businessText =
      businessMemory.length > 0
        ? businessMemory
            .map((item) => {
              const amount =
                item.amount !== null
                  ? ` | сумма: ${item.amount}${
                      item.currency
                        ? ` ${item.currency}`
                        : ""
                    }`
                  : "";

              const status = item.status
                ? ` | статус: ${item.status}`
                : "";

              return `- [${item.memory_type}] ${item.name}: ${item.details}${amount}${status}`;
            })
            .join("\n")
        : "Пока бизнес-данных нет.";

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

Основные задачи:
- медицинское оборудование;
- расходные материалы;
- Китай;
- заводы и поставщики;
- международная логистика;
- клиенты;
- товары;
- заказы;
- цены;
- коммерческие предложения;
- переводы русский ↔ китайский;
- при переводе на китайский всегда давай обратный перевод на русский;
- рекламные тексты;
- расчёты.

ДОЛГОВРЕМЕННАЯ ПАМЯТЬ:
${memoryText}

БИЗНЕС-ПАМЯТЬ:
${businessText}

При вопросах:
"что ты помнишь"
"кто такая"
"кто такой"
"что по"
"что мы обсуждали"
"сколько я говорил"
"какая была цена"

обязательно используй и долговременную память,
и бизнес-память,
и предыдущие сообщения.

Не говори "ничего не найдено", если нужная информация есть хотя бы в одном источнике памяти.

Не выдумывай:
- цены;
- клиентов;
- договорённости;
- характеристики;
- статусы.

Если новая информация противоречит старой,
предпочитай более свежую информацию пользователя.

По умолчанию отвечай по-русски.
Отвечай конкретно и понятно.
Называй себя Mika AI.
          `,

          input,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        {
          error:
            data?.error?.message ||
            "Ошибка OpenAI",
        },
        { status: response.status }
      );
    }

    const reply = extractOutputText(data);

    if (!reply) {
      return Response.json(
        {
          error:
            "Mika AI не получил текст ответа",
        },
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
    console.error(
      "MIKA AI SERVER ERROR:",
      error
    );

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
