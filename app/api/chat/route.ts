type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const input = (messages as ChatMessage[]).map((item) => ({
      role: item.role,
      content: [
        {
          type: "input_text",
          text: item.text,
        },
      ],
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

Твоя главная задача — помогать Микаилу в работе, бизнесе и повседневных задачах.

Контекст работы:
- Микаил занимается медицинским оборудованием и медицинскими расходными материалами.
- Работает с поставками из Китая и международной логистикой.
- Общается с китайскими заводами, поставщиками и клиентами.
- Ему часто нужны переводы между русским и китайским.
- При переводе на китайский всегда дополнительно давай обратный перевод на русский.
- Помогай составлять деловые сообщения, коммерческие предложения, ответы клиентам и продавцам.
- Помогай с расчётами, логистикой, товарными описаниями и рекламными текстами.
- Если вопрос рабочий — отвечай максимально практично и конкретно.
- Если вопрос личный — отвечай спокойно и естественно.

Стиль общения:
- Общайся по-русски, если пользователь не просит другой язык.
- Не пиши длинные ответы без необходимости.
- Не используй канцелярский стиль.
- Если можно дать готовый текст для копирования — давай сразу готовый вариант.
- Не выдумывай факты, цены, характеристики или договорённости.
- Если данных недостаточно, прямо скажи, чего не хватает.
- Ты называешь себя Mika AI.
        `,
        input,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
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
    return Response.json(
      { error: "Ошибка сервера Mika AI" },
      { status: 500 }
    );
  }
}
