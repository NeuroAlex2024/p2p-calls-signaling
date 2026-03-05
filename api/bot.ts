export const config = {
    runtime: 'edge',
};

export default async function handler(request: Request) {
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN || "8717051242:AAES02KtotkT6tq6y6uGf_I9ObpKqP7sThk";

    try {
        const body = await request.json();

        if (body.inline_query) {
            const inlineQueryId = body.inline_query.id;
            // Generate a random room ID (similar to nanoid)
            const roomID = Math.random().toString(36).substring(2, 10);
            const joinUrl = `https://t.me/p2pcal_bot/app?startapp=${roomID}`;
            const iconUrl = 'https://p2p-calls.vercel.app/phone.png';

            const results = [
                {
                    type: "article",
                    id: roomID,
                    title: "📞 Создать комнату",
                    description: "P2P-звонок с шифрованием",
                    thumbnail_url: iconUrl,
                    input_message_content: {
                        message_text: `📞 Безопасный P2P-звонок\n\nПрисоединяйтесь по кнопке ниже:`
                    },
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Открыть комнату", url: joinUrl }]
                        ]
                    }
                }
            ];

            await fetch(`https://api.telegram.org/bot${token}/answerInlineQuery`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    inline_query_id: inlineQueryId,
                    results: results,
                    cache_time: 0,
                }),
            });
        }
    } catch (e) {
        console.error(e);
    }

    return new Response("OK", { status: 200 });
}
