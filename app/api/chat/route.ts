export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: message,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: data?.error?.message || "Ошибка OpenAI API" },
        { status: 500 }
      );
    }

    return Response.json({
      reply: data.output_text,
    });
  } catch (error) {
    return Response.json(
      { error: "Ошибка сервера Mika AI" },
      { status: 500 }
    );
  }
}
