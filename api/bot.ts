export const config = {
    runtime: 'edge',
};

const APP_URL = 'https://p2p-calls.vercel.app';
const BOT_USERNAME = 'p2pcal_bot';
const ICON_URL = `${APP_URL}/phone.png`;

/** Отправляет запрос к Telegram Bot API */
async function tgCall(token: string, method: string, payload: Record<string, unknown>) {
    return fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

/** Генерирует случайный ID комнаты */
function makeRoomID(): string {
    return Math.random().toString(36).substring(2, 10);
}

export default async function handler(request: Request) {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN!;

    try {
        const body = await request.json();

        // ─── 1. INLINE QUERY ──────────────────────────────────────────────────────
        // Срабатывает когда пользователь вводит @p2pcal_bot в любом чате.
        // switch_pm_text даёт новым пользователям (никогда не запускавшим бота) кнопку
        // "Открыть бот" в верхней части инлайн-панели. После нажатия Telegram открывает
        // личку с ботом, пользователь жмёт Start — и Telegram автоматически возвращает
        // его обратно в инлайн-режим с тем же запросом.
        if (body.inline_query) {
            const inlineQueryId = body.inline_query.id;
            const roomID = makeRoomID();
            const joinUrl = `https://t.me/${BOT_USERNAME}/app?startapp=${roomID}`;

            await tgCall(token, 'answerInlineQuery', {
                inline_query_id: inlineQueryId,
                cache_time: 0,
                // Кнопка для новых пользователей — появляется в самом верху панели
                switch_pm_text: '🔓 Открыть бот',
                // "inline" — произвольный параметр, бот получит его как /start inline
                switch_pm_parameter: 'inline',
                results: [
                    {
                        type: 'article',
                        id: roomID,
                        title: '📞 Создать комнату',
                        description: 'Безопасный P2P-звонок с шифрованием',
                        thumbnail_url: ICON_URL,
                        input_message_content: {
                            message_text: '📞 Безопасный P2P-звонок\n\nНажмите кнопку ниже чтобы присоединиться:',
                        },
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Открыть комнату', url: joinUrl }],
                            ],
                        },
                    },
                ],
            });
        }

        // ─── 2. /start COMMAND ───────────────────────────────────────────────────
        // Обрабатывает команду /start в личке.
        // Если после /start передан параметр (roomID или "inline") — пользователь
        // пришёл через кнопку switch_pm. Отвечаем приветствием и кнопкой открытия
        // webapp, чтобы он сразу мог вернуться к созданию комнаты.
        if (body.message?.text?.startsWith('/start')) {
            const chatId = body.message.chat.id;
            const param = body.message.text.split(' ')[1] ?? '';

            // Если param выглядит как roomID (не пустой и не "inline") — пользователь
            // попал сюда после выбора инлайн-результата (редкий случай), открываем комнату.
            const isRoomID = param && param !== 'inline';
            const joinUrl = isRoomID
                ? `https://t.me/${BOT_USERNAME}/app?startapp=${param}`
                : `https://t.me/${BOT_USERNAME}/app`;

            await tgCall(token, 'sendMessage', {
                chat_id: chatId,
                text: isRoomID
                    ? '📞 Комната ждёт!\n\nНажмите кнопку ниже чтобы присоединиться к звонку:'
                    : '👋 Привет!\n\nВернитесь в чат, снова введите @p2pcal_bot — и отправьте ссылку на комнату собеседнику.',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: isRoomID ? '📞 Войти в комнату' : '📞 Открыть приложение', url: joinUrl }],
                    ],
                },
            });
        }

    } catch (e) {
        console.error(e);
    }

    return new Response('OK', { status: 200 });
}
