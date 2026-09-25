export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}


export async function POST(request: Request) {
  try {
    const body = await request.json();

    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    // Если это не входящее сообщение — просто подтверждаем получение
    if (!message) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const from = message.from;
    const messageType = message.type;

    // Пока работаем только с текстом
    if (messageType !== "text") {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const userText = message?.text?.body?.trim();

    if (!userText) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    console.log("WhatsApp message:", {
      from,
      text: userText,
    });

    // Отправляем сообщение в Mika AI
    const chatUrl = new URL("/api/chat", request.url);

    const chatResponse = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
     body: JSON.stringify({
  messages: [
    {
      role: "user",
      text: userText,
    },
  ],
}),
});
    if (!chatResponse.ok) {
      console.error(
        "Mika AI error:",
        chatResponse.status,
        await chatResponse.text()
      );

      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const rawAnswer = await chatResponse.text();

    let answer = rawAnswer;

    // Если /api/chat возвращает JSON — пытаемся достать ответ
    try {
      const json = JSON.parse(rawAnswer);

      answer =
        json.reply ||
        json.response ||
        json.answer ||
        json.message ||
        json.text ||
        rawAnswer;
    } catch {
      // Если это обычный текст — оставляем как есть
    }

    if (typeof answer !== "string") {
      answer = JSON.stringify(answer);
    }

    answer = answer.trim();

    if (!answer) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    // Версию Graph API потом зададим в Vercel.
    // Если переменной пока нет — используется эта версия.
    const apiVersion =
      process.env.WHATSAPP_API_VERSION || "v23.0";

    if (!phoneNumberId || !accessToken) {
      console.error(
        "Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN"
      );

      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // Отправляем ответ обратно клиенту в WhatsApp
    const whatsappResponse = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: from,
          type: "text",
          text: {
            body: answer.slice(0, 4096),
          },
        }),
      }
    );

    if (!whatsappResponse.ok) {
      console.error(
        "WhatsApp send error:",
        whatsappResponse.status,
        await whatsappResponse.text()
      );
    } else {
      console.log("Mika AI reply sent to:", from);
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);

    // Meta должен получить 200, чтобы не повторять webhook снова и снова
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
}
