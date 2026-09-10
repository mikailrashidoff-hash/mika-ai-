type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

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

    const input = messages
      .filter(
        (item) =>
          item &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.text === "string"
      )
      .map((item) => ({
        role: item.role,
        content: item.text,
      }));

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

Помогай Микаилу в работе, бизнесе и повседневных задачах.

Контекст:
- медицинское оборудование и расходные материалы;
- поставки из Китая и международная логистика;
- общение с китайскими заводами, поставщиками и клиентами;
- переводы между русским и китайским;
- при переводе на китайский всегда давай обратный перевод на русский;
- помогай с деловыми сообщениями, коммерческими предложениями,
  расчётами, логистикой, рекламными и товарными текстами.

Стиль:
- по умолчанию отвечай по-русски;
- отвечай конкретно;
- не выдумывай цены, характеристики и договорённости;
- учитывай контекст текущей переписки;
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
          error: data?.error?.message || "Ошибка OpenAI API",
        },
        { status: response.status }
      );
    }

    const reply =
      data?.output
        ?.flatMap((item: any) => item?.content || [])
        ?.find((item: any) => item?.type === "output_text")
        ?.text || "";

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
