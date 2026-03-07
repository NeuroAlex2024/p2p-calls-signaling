import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PhoneOff, Phone, Mic, MicOff, Volume2, VolumeX, ArrowLeft, TriangleAlert as AlertTriangle, Check } from 'lucide-react';
import { usePeer } from '../hooks/usePeer';
import { useCallStore } from '../store/useCallStore';
import { clsx } from 'clsx';

const isAndroid = /Android/i.test(navigator.userAgent);

const RoomScreen: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { initGuest, prewarmGuestConnection, cleanup } = usePeer();
    const {
        status,
        remoteStream,
        error,
        isMuted,
        setMuted,
        isRemoteMuted,
        setRemoteMuted,
        localStream
    } = useCallStore();

    const [time, setTime] = useState(0);
    const [countdown, setCountdown] = useState(10);
    const [waitingJoin, setWaitingJoin] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);
    const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const wave1Ref = useRef<HTMLDivElement>(null);
    const wave2Ref = useRef<HTMLDivElement>(null);

    const isInitialMount = useRef(true);

    // Гость на Android: показываем кнопку «Ответить» вместо автоподключения
    // На iOS — автоматически, там user gesture не нужен для audio playback
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            if (status === 'idle' && id) {
                if (isAndroid) {
                    setWaitingJoin(true);
                    prewarmGuestConnection(); // Тихо прогреваем вебсокет-слой!
                } else {
                    initGuest(id);
                }
            }
        } else {
            if (status === 'idle' || status === 'error') {
                navigate('/');
            }
        }
    }, [id, status, initGuest, prewarmGuestConnection, navigate]);

    const handleJoinCall = () => {
        // Принудительно регистрируем user gesture для HTMLMediaElement
        if (audioRef.current) {
            audioRef.current.volume = 0; // Временно глушим, если начнет зацикливаться
            audioRef.current.play().catch(() => {
                // Игнорируем ошибку пустого srcPolicy, жест засчитан браузером
            });
            audioRef.current.volume = 1;
        }

        setWaitingJoin(false);
        if (id) initGuest(id);
    };

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
                        cleanup({ error: 'SERVER_BUSY', status: 'error' });
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            setCountdown(10);
        }
        return () => clearInterval(interval);
    }, [status, cleanup]);

    useEffect(() => {
        if (!remoteStream) return;

        // Путь 1: Web Audio API — надёжен на Android после unlockAudio()
        const audioCtx = useCallStore.getState().audioContext;
        if (audioCtx && audioCtx.state !== 'closed') {
            try {
                if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });
                // Отключаем предыдущий source если был
                if (audioSourceRef.current) {
                    try { audioSourceRef.current.disconnect(); } catch { }
                }
                const source = audioCtx.createMediaStreamSource(remoteStream);
                source.connect(audioCtx.destination);
                audioSourceRef.current = source;
            } catch (e) {
                console.error('[Audio] Web Audio route failed:', e);
            }
        }

        // Путь 2: <audio> element — fallback (работает на iOS и десктопе)
        if (audioRef.current) {
            audioRef.current.srcObject = remoteStream;
            audioRef.current.play().catch(e => console.error('[Audio] element playback failed:', e));
        }

        return () => {
            if (audioSourceRef.current) {
                try { audioSourceRef.current.disconnect(); } catch { }
                audioSourceRef.current = null;
            }
        };
    }, [remoteStream]);

    // Audio Visualizer for connected state
    useEffect(() => {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (!isIOS) return; // Disable visualizer on Android to save resources and prevent glitches

        if (status !== 'connected' || !remoteStream) return;

        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;

        let audioCtx: AudioContext;
        let animationId: number;

        try {
            audioCtx = new AudioContext();
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;

            const source = audioCtx.createMediaStreamSource(remoteStream);
            source.connect(analyser);

            let currentVol = 0;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const checkVolume = () => {
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const average = sum / dataArray.length;
                const targetVol = Math.min(average / 100, 1);

                // Smooth easing
                currentVol = currentVol + (targetVol - currentVol) * 0.2;

                if (wave1Ref.current) {
                    wave1Ref.current.style.transform = `scale(${1.2 + currentVol * 0.8})`;
                    wave1Ref.current.style.opacity = `${Math.max(0, 0.3 - currentVol * 0.1)}`;
                }
                if (wave2Ref.current) {
                    wave2Ref.current.style.transform = `scale(${1.0 + currentVol * 0.4})`;
                    wave2Ref.current.style.opacity = `${Math.max(0, 0.5 - currentVol * 0.2)}`;
                }

                animationId = requestAnimationFrame(checkVolume);
            };
            checkVolume();

        } catch (e) {
            console.error('Visualizer init failed:', e);
        }

        return () => {
            if (animationId) cancelAnimationFrame(animationId);
            if (audioCtx && audioCtx.state !== 'closed') {
                audioCtx.close().catch(() => { });
            }
        };
    }, [status, remoteStream]);

    // Handle mute
    useEffect(() => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    }, [isMuted, localStream]);

    // Handle remote mute
    useEffect(() => {
        if (remoteStream) {
            remoteStream.getAudioTracks().forEach(track => {
                track.enabled = !isRemoteMuted;
            });
        }
        if (audioRef.current) {
            audioRef.current.muted = isRemoteMuted;
        }
    }, [isRemoteMuted, remoteStream]);

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
                            ? 'Комната закрыта или хост еще не подключился.'
                            : error === 'SERVER_BUSY'
                                ? 'К сожалению, время ожидания истекло. Создайте комнату заново.'
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

    // Android: экран «Входящий звонок» — нужен tap для разблокировки аудио
    if (waitingJoin) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-10 animate-in fade-in duration-500">
                <div className="relative">
                    <div className="absolute inset-0 bg-success/20 rounded-full animate-ping" />
                    <div className="absolute inset-0 bg-success/10 rounded-full animate-pulse" />
                    <div className="relative w-32 h-32 bg-success/10 rounded-full flex items-center justify-center">
                        <Phone className="w-14 h-14 text-success" />
                    </div>
                </div>

                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold tracking-tight">Входящий звонок</h2>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                        Нажмите, чтобы присоединиться
                    </p>
                </div>

                <button
                    onClick={handleJoinCall}
                    className="w-20 h-20 rounded-full bg-success flex items-center justify-center text-white shadow-xl shadow-success/30 active:scale-90 transition-transform"
                >
                    <Phone className="w-10 h-10" />
                </button>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col pt-4">
            <audio ref={audioRef} autoPlay playsInline style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />

            {/* Header */}
            <div className="flex items-center px-4 py-2 border-b border-zinc-50 dark:border-zinc-800/50">
                <button onClick={handleEndCall} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <h2 className="flex-1 text-center font-bold text-lg mr-10">
                    {status === 'connected' ? 'Соединение установлено' : 'Ожидание собеседника...'}
                </h2>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center pb-24 space-y-8">
                <div className="relative">
                    {/* Pulsing rings for active call */}
                    {status === 'connected' && (
                        <>
                            <div
                                ref={wave1Ref}
                                className="absolute inset-0 bg-success/40 rounded-full transition-transform duration-75 will-change-transform ease-out pointer-events-none"
                                style={{ transform: 'scale(1.2)', opacity: 0.3 }}
                            />
                            <div
                                ref={wave2Ref}
                                className="absolute inset-0 bg-success/30 rounded-full transition-transform duration-75 will-change-transform ease-out pointer-events-none"
                                style={{ transform: 'scale(1.0)', opacity: 0.5 }}
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
                        {status === 'connected' ? 'Собеседник' : 'Соединение...'}
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
                        onClick={() => setRemoteMuted(!isRemoteMuted)}
                        className={clsx(
                            "w-16 h-16 rounded-full flex items-center justify-center transition-all",
                            isRemoteMuted ? "bg-zinc-800 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                        )}
                    >
                        {isRemoteMuted ? <VolumeX className="w-7 h-7" /> : <Volume2 className="w-7 h-7" />}
                    </button>
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-tighter">собеседник</span>
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
