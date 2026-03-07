import React, { useState } from 'react';
import { Phone, Copy, Check, Loader2, Mic } from 'lucide-react';
import { usePeer } from '../hooks/usePeer';
import { useCallStore } from '../store/useCallStore';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { trackEvent } from '../utils/analytics';

type Step = 'share' | 'mic';

const WAITING_MESSAGES = [
    "Собеседник получил ссылку... ✉️",
    "Раздумывает открывать ли её 🤔",
    "Вспоминает, где лежат наушники 🎧",
    "Заваривает чай ☕",
    "Вытирает крошки с экрана... 🧹",
    "Морально готовится к звонку 🧘‍♂️",
    "Ищет кнопку «Разрешить микрофон» 🎙️",
    "Почти готово! Настраиваем секретный P2P-канал 🤫",
];

const WaitingStatusMessages: React.FC = () => {
    const [index, setIndex] = React.useState(0);
    const [fade, setFade] = React.useState(true);

    React.useEffect(() => {
        const interval = setInterval(() => {
            setFade(false);
            setTimeout(() => {
                setIndex((prev) => (prev + 1) % WAITING_MESSAGES.length);
                setFade(true);
            }, 300); // 300ms для fade-out
        }, 3500); // Смена каждые 3.5 секунды

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="h-6 flex items-center justify-center">
            <p className={`text-center text-sm font-medium text-zinc-500 dark:text-zinc-400 transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'}`}>
                {WAITING_MESSAGES[index]}
            </p>
        </div>
    );
};

const MainScreen: React.FC = () => {
    const { startHostSession, prewarmHostConnection } = usePeer();
    const { status, roomID, error, setRoomID } = useCallStore();
    const navigate = useNavigate();
    const [copied, setCopied] = React.useState(false);
    const [step, setStep] = useState<Step>('share');

    React.useEffect(() => {
        if (status === 'connected' && roomID) {
            navigate(`/room/${roomID}`);
        }
    }, [status, roomID, navigate]);

    React.useEffect(() => {
        if (!roomID && (status === 'idle' || status === 'error')) {
            const newId = nanoid(7);
            setRoomID(newId);
            prewarmHostConnection(newId);
            setStep('share');
        }
    }, [roomID, status, setRoomID, prewarmHostConnection]);

    const handleShareClick = () => {
        if (!roomID) return;

        // ── АНАЛИТИКА: share_clicked ──────────────────────────────────────────
        trackEvent('share_clicked', { room_id: roomID });

        const tg = (window as any).Telegram?.WebApp;
        if (tg?.initData) {
            const botUrl = `https://t.me/p2pcal_bot/app?startapp=${roomID}`;
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${encodeURIComponent('Присоединяйся к защищенному звонку 📞:')}`;
            tg.openTelegramLink(shareUrl);
        } else {
            const url = `${window.location.origin}/room/${roomID}`;
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }

        // Переходим на следующий шаг
        setStep('mic');
    };

    const handleMicClick = () => {
        if (!roomID) return;
        // Запуск PeerJS соединения и запрос микрофона
        startHostSession(roomID);
    };

    const isIdleOrError = status === 'idle' || status === 'error';

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-12">
            <div className="flex flex-col items-center space-y-4">
                <div className="w-32 h-32 bg-primary/10 rounded-full flex items-center justify-center">
                    <Phone className="w-16 h-16 text-primary fill-primary/20" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">P2P_Calls</h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-center text-lg max-w-[240px]">
                    Безопасные звонки напрямую между устройствами
                </p>
            </div>

            <div className="w-full space-y-4">
                {isIdleOrError ? (
                    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {error && (
                            <div className="bg-destructive/10 text-destructive text-[11px] font-bold uppercase tracking-wider px-4 py-3 rounded-xl text-center animate-in fade-in slide-in-from-top-2">
                                {error === 'CONNECTION_LOST'
                                    ? 'Связь с сервером потеряна'
                                    : error === 'SERVER_TIMEOUT'
                                        ? 'Сервер не отвечает. Повторите попытку.'
                                        : error === 'MEDIA_REFUSED'
                                            ? 'Нет доступа к микрофону'
                                            : 'Ошибка соединения. Попробуйте снова.'}
                            </div>
                        )}

                        {step === 'share' ? (
                            <div className="bg-surface-secondary dark:bg-zinc-900 rounded-2xl p-4 space-y-4 shadow-sm border border-zinc-100 dark:border-zinc-800">
                                <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1">
                                    Пригласить собеседника
                                </span>

                                {(window as any).Telegram?.WebApp?.initData ? (
                                    <button
                                        onClick={handleShareClick}
                                        disabled={!roomID}
                                        className="w-full flex items-center justify-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50 shadow-sm"
                                    >
                                        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
                                        </svg>
                                        <span>Отправить в Telegram</span>
                                    </button>
                                ) : (
                                    <div className="flex bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
                                        <input
                                            readOnly
                                            value={roomID ? `https://p2p-calls.vercel.app/room/${roomID}` : 'Генерация ссылки...'}
                                            className="flex-1 px-4 py-3 text-sm font-medium outline-none truncate bg-transparent text-zinc-900 dark:text-zinc-100"
                                        />
                                        <button
                                            onClick={handleShareClick}
                                            disabled={!roomID}
                                            className="bg-primary text-white p-3 hover:bg-primary-hover transition-colors disabled:opacity-50"
                                        >
                                            {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-success/5 dark:bg-success/10 rounded-2xl p-6 flex flex-col items-center space-y-4 shadow-sm border border-success/20 animate-in fade-in slide-in-from-bottom-4">
                                <div className="w-16 h-16 bg-success/20 text-success rounded-full flex items-center justify-center">
                                    <Mic className="w-8 h-8" />
                                </div>
                                <div className="text-center space-y-1">
                                    <h3 className="font-bold text-zinc-900 dark:text-zinc-50">Разрешите микрофон</h3>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        Мы не сохраняем ваши данные, предоставьте доступ заново
                                    </p>
                                </div>
                                <button
                                    onClick={handleMicClick}
                                    className="w-full bg-success hover:bg-success/90 text-white shadow-lg shadow-success/20 py-3 rounded-xl font-bold transition-all"
                                >
                                    Дать доступ
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <WaitingStatusMessages />
                    </div>
                )}
            </div>

            <div className="w-full mt-auto pt-8 pb-2 flex flex-col items-center">
                <div className="h-px w-3/4 bg-zinc-100 dark:bg-zinc-800 mb-6" />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 font-medium uppercase tracking-[0.1em] text-center px-8">
                    Без регистрации • Без серверов • Полная конфиденциальность
                </p>
            </div>
        </div>
    );
};

export default MainScreen;
