import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PhoneOff, Phone, Mic, MicOff, Volume2, ArrowLeft, TriangleAlert as AlertTriangle, Check } from 'lucide-react';
import { usePeer } from '../hooks/usePeer';
import { useCallStore } from '../store/useCallStore';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';

const RoomScreen: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { initGuest, cleanup } = usePeer();
    const {
        status,
        remoteStream,
        error,
        isMuted,
        setMuted,
        isSpeakerOn,
        setSpeakerOn,
        localStream
    } = useCallStore();

    const [time, setTime] = useState(0);
    const [countdown, setCountdown] = useState(15);
    const audioRef = useRef<HTMLAudioElement>(null);

    const isInitialMount = useRef(true);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            // If we land here and status is idle, it means we are the Guest
            if (status === 'idle' && id) {
                initGuest(id);
            }
        } else {
            // Once we're mounted, if status drops to idle or error, route back to main screen
            if (status === 'idle' || status === 'error') {
                navigate('/');
            }
        }
    }, [id, status, initGuest, navigate]);

    useEffect(() => {
        let interval: number;
        if (status === 'connected') {
            interval = setInterval(() => {
                setTime((t) => t + 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [status]);

    useEffect(() => {
        let interval: number;
        if (status === 'linking') {
            interval = window.setInterval(() => {
                setCountdown((prev) => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        useCallStore.getState().setError('SERVER_BUSY');
                        useCallStore.getState().setStatus('error');
                        cleanup();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            setCountdown(15);
        }
        return () => clearInterval(interval);
    }, [status, cleanup]);

    useEffect(() => {
        if (audioRef.current && remoteStream) {
            audioRef.current.srcObject = remoteStream;
            audioRef.current.play().catch(e => console.error("Audio playback failed", e));
        }
    }, [remoteStream]);

    // Handle mute
    useEffect(() => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    }, [isMuted, localStream]);

    // Handle speaker (volume adjustment for remote stream)
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = isSpeakerOn ? 1 : 0.2; // Dim if not "speaker" mode
        }
    }, [isSpeakerOn]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleEndCall = () => {
        cleanup();
        navigate('/');
    };

    if (status === 'error' || error) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-8 animate-in fade-in duration-500">
                <div className="w-24 h-24 bg-destructive/10 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-12 h-12 text-destructive" />
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-xl font-bold">
                        {error === 'LINK_INVALID'
                            ? 'Ссылка недействительна'
                            : error === 'SERVER_BUSY'
                                ? 'Сервер занят'
                                : error === 'ICE_FAILED'
                                    ? 'Нет прямого соединения'
                                    : 'Произошла ошибка'}
                    </h2>
                    <p className="text-zinc-500 text-sm">
                        {error === 'LINK_INVALID'
                            ? 'Комната закрыта или ссылка больше не работает.'
                            : error === 'SERVER_BUSY'
                                ? 'К сожалению, сервер занят, создайте комнату заново'
                                : error === 'ICE_FAILED'
                                    ? 'Не удалось установить P2P-канал. Попробуйте позвонить снова.'
                                    : 'Не удалось установить соединение. Попробуйте еще раз.'}
                    </p>
                </div>
                <button
                    onClick={() => navigate('/')}
                    className="tg-button bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>На главную</span>
                </button>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col pt-4">
            <audio ref={audioRef} autoPlay playsInline className="hidden" />

            {/* Header */}
            <div className="flex items-center px-4 py-2 border-b border-zinc-50 dark:border-zinc-800/50">
                <button onClick={handleEndCall} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <h2 className="flex-1 text-center font-bold text-lg mr-10">
                    {status === 'connected' ? 'Соединение установлено' : 'Подключение...'}
                </h2>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center pb-24 space-y-8">
                <div className="relative">
                    {/* Pulsing rings for active call */}
                    {status === 'connected' && (
                        <>
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1.5, opacity: 0 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                                className="absolute inset-0 bg-primary/20 rounded-full"
                            />
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1.8, opacity: 0 }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.5 }}
                                className="absolute inset-0 bg-primary/10 rounded-full"
                            />
                        </>
                    )}

                    <div className={clsx(
                        "w-48 h-48 rounded-full border-4 flex items-center justify-center bg-white dark:bg-zinc-900 z-10 relative transition-colors duration-500",
                        status === 'connected' ? "border-success/30 shadow-2xl shadow-success/10" : "border-primary/20 shadow-xl shadow-primary/5"
                    )}>
                        <div className={clsx(
                            "w-40 h-40 rounded-full flex items-center justify-center transition-all duration-700",
                            status === 'connected' ? "bg-success scale-100" : "bg-primary/10 scale-95"
                        )}>
                            {status === 'connected' ? (
                                <div className="bg-white dark:bg-zinc-800 rounded-2xl p-4 shadow-lg">
                                    <div className="w-16 h-16 bg-success/20 rounded-xl flex items-center justify-center">
                                        <Check className="w-10 h-10 text-success" />
                                    </div>
                                </div>
                            ) : (
                                <Phone className="w-16 h-16 text-primary animate-pulse" />
                            )}
                        </div>
                    </div>
                </div>

                <div className="text-center space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight">
                        {status === 'connected' ? 'Собеседник' : 'Поиск пира...'}
                    </h1>
                    <p className="text-primary font-medium text-lg min-h-[1.75rem]">
                        {status === 'connected' ? formatTime(time) : `До подключения осталось ${countdown}...`}
                    </p>
                </div>
            </div>

            {/* Controls Container */}
            <div className="px-8 pb-12 flex items-center justify-between">
                <div className="flex flex-col items-center gap-2">
                    <button
                        onClick={() => setSpeakerOn(!isSpeakerOn)}
                        className={clsx(
                            "w-16 h-16 rounded-full flex items-center justify-center transition-all",
                            isSpeakerOn ? "bg-primary text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                        )}
                    >
                        <Volume2 className="w-7 h-7" />
                    </button>
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-tighter">динамик</span>
                </div>

                <div className="flex flex-col items-center gap-2">
                    <button
                        onClick={handleEndCall}
                        className="w-20 h-20 rounded-full bg-destructive flex items-center justify-center text-white shadow-xl shadow-destructive/30 active:scale-90 transition-transform"
                    >
                        <PhoneOff className="w-10 h-10" />
                    </button>
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-tighter">завершить</span>
                </div>

                <div className="flex flex-col items-center gap-2">
                    <button
                        onClick={() => setMuted(!isMuted)}
                        className={clsx(
                            "w-16 h-16 rounded-full flex items-center justify-center transition-all",
                            isMuted ? "bg-zinc-800 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                        )}
                    >
                        {isMuted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                    </button>
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-tighter">убрать звук</span>
                </div>
            </div>
        </div>
    );
};

export default RoomScreen;
