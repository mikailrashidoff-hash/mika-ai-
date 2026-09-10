type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const input = (messages as ChatMessage[]).map((item) => ({
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
- отвечай конкретно и без лишней воды;
- не выдумывай факты, цены или договорённости;
- помни контекст текущего диалога;
- называй себя Mika AI.
        `,
        input,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: data?.error?.message || "Ошибка OpenAI API" },
        { status: response.status }
      );
    }

    const reply =
      data?.output
        ?.flatMap((item: any) => item?.content || [])
        ?.find((item: any) => item?.type === "output_text")
        ?.text || "";

    return Response.json({ reply });
  } catch {
    return Response.json(
      { error: "Ошибка сервера Mika AI" },
      { status: 500 }
    );
  }
}
