import React from 'react';
import { Phone, Plus, Copy, Check, Loader2 } from 'lucide-react';
import { usePeer } from '../hooks/usePeer';
import { useCallStore } from '../store/useCallStore';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';

const MainScreen: React.FC = () => {
    const { initHost } = usePeer();
    const { status, roomID, error } = useCallStore();
    const navigate = useNavigate();
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        if (status === 'connected' && roomID) {
            navigate(`/room/${roomID}`);
        }
    }, [status, roomID, navigate]);

    const handleCreateRoom = () => {
        if (status === 'linking') return;
        initHost();
    };

    const copyToClipboard = () => {
        const url = `${window.location.origin}/room/${roomID}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const isIdleOrError = status === 'idle' || status === 'error';
    const isLinking = status === 'linking';

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
                {isIdleOrError || isLinking ? (
                    <div className="space-y-4">
                        <button
                            disabled={isLinking}
                            onClick={handleCreateRoom}
                            className={clsx(
                                "w-full tg-button text-white shadow-lg transition-all",
                                isLinking ? "bg-zinc-400 rotate-0" : "bg-primary hover:bg-primary-hover shadow-primary/20"
                            )}
                        >
                            {isLinking ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <Plus className="w-5 h-5" />
                            )}
                            <span>{isLinking ? 'Подключение к сети...' : 'Создать комнату'}</span>
                        </button>

                        {status === 'error' && error && (
                            <div className="bg-destructive/10 text-destructive text-[11px] font-bold uppercase tracking-wider px-4 py-3 rounded-xl text-center animate-in fade-in slide-in-from-top-2">
                                {error === 'CONNECTION_LOST'
                                    ? 'Связь с сервером потеряна'
                                    : error === 'SERVER_TIMEOUT'
                                        ? 'Сервер не отвечает. Повторите попытку.'
                                        : error === 'LINK_INVALID'
                                            ? 'Ссылка недействительна или комната закрыта'
                                            : 'Ошибка соединения. Попробуйте снова.'}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-surface-secondary dark:bg-zinc-900 rounded-2xl p-4 space-y-4">
                            <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-1">
                                Ссылка на комнату
                            </span>

                            {(window as any).Telegram?.WebApp?.initData ? (
                                <button
                                    onClick={() => {
                                        const tg = (window as any).Telegram.WebApp;
                                        // Generate direct link using startapp parameter
                                        const botUrl = `https://t.me/p2pcal_bot/app?startapp=${roomID}`;
                                        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${encodeURIComponent('Присоединяйся к защищенному звонку 📞:')}`;
                                        tg.openTelegramLink(shareUrl);
                                    }}
                                    className="w-full flex items-center justify-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white py-3 rounded-xl font-medium transition-colors"
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
                                        value={`https://p2p-calls.vercel.app/room/${roomID}`}
                                        className="flex-1 px-4 py-3 text-sm font-medium outline-none truncate bg-transparent text-zinc-900 dark:text-zinc-100"
                                    />
                                    <button
                                        onClick={copyToClipboard}
                                        className="bg-primary text-white p-3 hover:bg-primary-hover transition-colors"
                                    >
                                        {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                                    </button>
                                </div>
                            )}
                        </div>
                        <p className="text-center text-sm text-zinc-400 animate-pulse">
                            Ожидание подключения...
                        </p>
                    </div>
                )}
            </div>

            <div className="absolute bottom-8 left-0 right-0 py-4 flex flex-col items-center border-t border-zinc-50 dark:border-zinc-800 mt-auto">
                <div className="h-px w-3/4 bg-zinc-100 dark:bg-zinc-800 mb-6" />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-600 font-medium uppercase tracking-[0.1em] text-center px-8">
                    Без регистрации • Без серверов • Полная конфиденциальность
                </p>
            </div>
        </div>
    );
};

export default MainScreen;
