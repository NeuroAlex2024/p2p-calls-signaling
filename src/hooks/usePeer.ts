import { useEffect, useCallback } from 'react';
import { Peer } from 'peerjs';
import type { MediaConnection, PeerOptions } from 'peerjs';

import { useCallStore } from '../store/useCallStore';
import type { CallStatus } from '../store/useCallStore';
import { trackEvent } from '../utils/analytics';

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
};

let cachedMediaStream: MediaStream | null = null;

async function getMediaStream(): Promise<MediaStream> {
    if (cachedMediaStream && cachedMediaStream.active && cachedMediaStream.getAudioTracks().every(t => t.readyState === 'live')) {
        return cachedMediaStream;
    }
    cachedMediaStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    return cachedMediaStream;
}

// ICE серверы: STUN от нескольких провайдеров + TURN через Open Relay Project (Metered).
// TURN используется браузером только как fallback когда прямой P2P невозможен
// (Symmetric NAT, строгие корпоративные файрволы). Трафик сквозь TURN зашифрован
// DTLS-SRTP — сервер видит только зашифрованные пакеты.
// Open Relay: бесплатно, 20 GB/мес, без регистрации. https://openrelay.metered.ca
const ICE_SERVERS: RTCIceServer[] = [
    // --- STUN (несколько провайдеров для надёжности) ---
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    // --- TURN / Open Relay Project (fallback при Symmetric NAT) ---
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
    {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
    {
        urls: 'turns:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
    },
];

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000; // ms
const CONNECTION_TIMEOUT = 12000; // ms

/**
 * "Разблокирует" аудио-выход на Android WebView.
 * Должна вызываться в цепочке от user gesture (click/tap).
 * Создаёт AudioContext, делает resume() и играет 1мс тишины —
 * после этого Android разрешает воспроизведение аудио навсегда.
 */
function unlockAudio(): AudioContext {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();

    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { });
    }

    // Играем беззвучный сигнал чтобы снять блокировку
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    // Снимаем блокировку для HTMLMediaElement
    try {
        const dummyAudio = new Audio();
        dummyAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        dummyAudio.play().catch(() => { });
    } catch (e) { }

    return ctx;
}

/**
 * Подписывается на iceConnectionState у MediaConnection.
 * - 'failed'      → немедленно вызывает onFailed (звонок невозможен)
 * - 'disconnected'→ запускает таймер: если через 5 с не восстановился → onFailed
 */
function watchIceState(call: MediaConnection, onFailed: () => void): () => void {
    const pc = call.peerConnection as RTCPeerConnection | undefined;
    if (!pc) return () => { };

    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearDisconnectTimer = () => {
        if (disconnectTimer !== null) {
            clearTimeout(disconnectTimer);
            disconnectTimer = null;
        }
    };

    const handler = () => {
        const state = pc.iceConnectionState;
        console.log('[ICE]', state);

        if (state === 'failed' || state === 'closed') {
            clearDisconnectTimer();
            onFailed();
        } else if (state === 'disconnected') {
            // Даём 5 секунд на самовосстановление (например, смена сети)
            disconnectTimer = setTimeout(() => {
                if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                    onFailed();
                }
            }, 5000);
        } else if (state === 'connected' || state === 'completed') {
            // Соединение (вос)становлено — сбрасываем таймер
            clearDisconnectTimer();
        }
    };

    pc.addEventListener('iceconnectionstatechange', handler);

    return () => {
        clearDisconnectTimer();
        pc.removeEventListener('iceconnectionstatechange', handler);
    };
}

/** PeerJS config: сигнализация через домашний сервер или 0.peerjs.com, NAT traversal через Google STUN */
function getPeerConfig(): Partial<PeerOptions> {
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isDev) {
        return {
            host: 'localhost',
            port: 9000,
            path: '/peerjs',
            secure: false, // локально без SSL
            debug: 1,
            config: { iceServers: ICE_SERVERS },
            pingInterval: 10000,
        };
    }

    // Продакшен: читаем из env-переменных если заданы, иначе публичный сервер
    const host = import.meta.env.VITE_PEER_HOST;
    const port = import.meta.env.VITE_PEER_PORT;

    if (host && port) {
        return {
            host,
            port: Number(port),
            path: '/peerjs',
            secure: Number(port) === 443 || import.meta.env.VITE_PEER_SECURE === 'true',
            debug: 1,
            config: { iceServers: ICE_SERVERS },
            pingInterval: 10000,
        };
    }

    // Fallback: публичный PeerJS сервер
    return {
        debug: 1,
        config: { iceServers: ICE_SERVERS },
        pingInterval: 10000,
    };
}

let currentCallRef: MediaConnection | null = null;
let isCleaningUpRef = false;
let prewarmedPeerRef: Peer | null = null;
let prewarmedHostPeerRef: Peer | null = null;
let prewarmedHostPromiseRef: Promise<Peer> | null = null;
let pendingHostCallRef: MediaConnection | null = null;

export const usePeer = () => {
    const {
        peer,
        setPeer,
        setLocalStream,
        setRemoteStream,
        setAudioContext,
        setStatus,
        setRoomID,
        setError,
        setPermissionModal,
    } = useCallStore();

    const cleanup = useCallback((finalState?: { error?: string; status?: CallStatus }) => {
        if (isCleaningUpRef) return;
        isCleaningUpRef = true;

        const state = useCallStore.getState();

        // 1. Немедленно останавливаем свои треки (чтобы другая сторона сразу поняла что звонок окончен)
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
        }
        if (cachedMediaStream) {
            cachedMediaStream.getTracks().forEach(track => track.stop());
            cachedMediaStream = null;
        }

        // 2. Закрываем звонок
        if (currentCallRef) {
            currentCallRef.close();
            currentCallRef = null;
        }

        const currentPeer = state.peer;
        if (currentPeer && !currentPeer.destroyed) {
            currentPeer.destroy();
        }

        if (prewarmedPeerRef && !prewarmedPeerRef.destroyed) {
            prewarmedPeerRef.destroy();
            prewarmedPeerRef = null;
        }

        if (prewarmedHostPeerRef && !prewarmedHostPeerRef.destroyed) {
            prewarmedHostPeerRef.destroy();
            prewarmedHostPeerRef = null;
        }
        prewarmedHostPromiseRef = null;
        pendingHostCallRef = null;

        state.reset(finalState);
        isCleaningUpRef = false;
    }, []);

    /** Create a Peer with retry logic */
    const createPeerWithRetry = useCallback(
        (id?: string): Promise<Peer> => {
            return new Promise((resolve, reject) => {
                const attempt = (retryNum: number) => {
                    const config = getPeerConfig();
                    const newPeer = id ? new Peer(id, config) : new Peer(config);

                    const timeout = setTimeout(() => {
                        if (!newPeer.open && !newPeer.destroyed) {
                            console.warn(`[PeerJS] Attempt ${retryNum + 1}/${MAX_RETRIES} timed out`);
                            newPeer.destroy();
                            retryOrFail();
                        }
                    }, CONNECTION_TIMEOUT);

                    const retryOrFail = () => {
                        clearTimeout(timeout);
                        if (retryNum + 1 < MAX_RETRIES) {
                            const delay = RETRY_BASE_DELAY * Math.pow(2, retryNum);
                            console.log(`[PeerJS] Retrying in ${delay}ms...`);
                            setTimeout(() => attempt(retryNum + 1), delay);
                        } else {
                            reject(new Error('SERVER_TIMEOUT'));
                        }
                    };

                    const onOpen = () => {
                        clearTimeout(timeout);
                        newPeer.off('open', onOpen);
                        newPeer.off('error', onError);
                        resolve(newPeer);
                    };

                    const onError = (err: any) => {
                        clearTimeout(timeout);
                        console.error(`[PeerJS] Error (attempt ${retryNum + 1}):`, err.type, err.message);

                        newPeer.off('open', onOpen);
                        newPeer.off('error', onError);

                        // Non-retryable errors
                        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
                            if (!newPeer.destroyed) newPeer.destroy();
                            reject(err);
                            return;
                        }

                        // Retryable: network / socket errors
                        if (!newPeer.destroyed) newPeer.destroy();
                        retryOrFail();
                    };

                    newPeer.on('open', onOpen);
                    newPeer.on('error', onError);
                };

                attempt(0);
            });
        },
        [],
    );

    const prewarmGuestConnection = useCallback(() => {
        if (prewarmedPeerRef) return;
        createPeerWithRetry().then(peer => {
            if (!isCleaningUpRef) {
                prewarmedPeerRef = peer;
            } else {
                peer.destroy();
            }
        }).catch((e) => {
            console.warn('[PeerJS] Prewarm failed:', e);
        });
    }, [createPeerWithRetry]);

    const prewarmHostConnection = useCallback((id: string) => {
        if (prewarmedHostPeerRef || prewarmedHostPromiseRef) return;
        const promise = createPeerWithRetry(id);
        prewarmedHostPromiseRef = promise;

        promise.then(peer => {
            if (!isCleaningUpRef) {
                prewarmedHostPeerRef = peer;
                peer.on('call', (call) => {
                    console.log('[PeerJS] Received early call during prewarm!');
                    pendingHostCallRef = call;
                });
            } else {
                peer.destroy();
            }
        }).catch((e) => {
            console.warn('[PeerJS] Host Prewarm failed:', e);
        }).finally(() => {
            prewarmedHostPromiseRef = null;
        });
    }, [createPeerWithRetry]);

    const startHostSession = useCallback(async (roomId: string) => {
        if (peer || useCallStore.getState().status === 'linking') return;

        try {
            setStatus('linking' as any);
            useCallStore.getState().setIsHost(true);

            // Android WebView: разблокируем аудио-выход СРАЗУ, ДО любых async/await
            const audioCtx = unlockAudio();
            setAudioContext(audioCtx);

            // Start fetching media stream in parallel with network connection
            // We do NOT await it here to save 1-2 seconds on room creation
            const streamPromise = getMediaStream().then(stream => {
                setLocalStream(stream);
                // ── АНАЛИТИКА: mic_allowed (хост выдал доступ к микрофону) ──
                trackEvent('mic_allowed', { room_id: roomId });
                return stream;
            }).catch(err => {
                console.error('[PeerJS] Media error during parallel stream fetch:', err);
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    setPermissionModal(true);
                }
                cleanup();
                setError('MEDIA_REFUSED');
                setStatus('error');
                throw err;
            });

            let newPeer = prewarmedHostPeerRef;
            if (!newPeer && prewarmedHostPromiseRef) {
                try {
                    newPeer = await prewarmedHostPromiseRef;
                } catch (e) {
                    console.warn('[PeerJS] Prewarm promise failed during session start:', e);
                }
            }

            if (newPeer && !newPeer.destroyed && newPeer.open && newPeer.id === roomId) {
                prewarmedHostPeerRef = null;
            } else {
                if (newPeer) newPeer.destroy();
                newPeer = await createPeerWithRetry(roomId);
            }

            setPeer(newPeer);
            setRoomID(roomId);
            setStatus('waiting');

            const handleCall = async (call: MediaConnection) => {
                if (currentCallRef) {
                    call.close();
                    return;
                }

                try {
                    currentCallRef = call;

                    // Await the parallel stream promise. If it was already resolved, it proceeds instantly
                    const stream = await streamPromise;

                    call.answer(stream);

                    call.on('stream', (remoteStream) => {
                        setRemoteStream(remoteStream);
                        setStatus('connected');
                        // ── АНАЛИТИКА: call_started (WebRTC установлен на стороне хоста) ──
                        trackEvent('call_started', { room_id: roomId });
                        remoteStream.getTracks().forEach(track => {
                            track.onended = () => {
                                console.log('[PeerJS] Remote track ended (host) - hanging up');
                                cleanup();
                            };
                        });
                    });

                    // Мониторинг ICE: если соединение упало — завершаем звонок с ошибкой
                    watchIceState(call, () => {
                        console.warn('[ICE] Connection failed on host side');
                        trackEvent('call_failed', { room_id: roomId, reason: 'ICE_FAILED' });
                        cleanup({ error: 'ICE_FAILED', status: 'error' });
                    });

                    call.on('close', () => cleanup());
                    call.on('error', () => cleanup());
                } catch (mediaErr: any) {
                    console.error('[PeerJS] Call runtime error:', mediaErr);
                    call.close();
                }
            };

            // Listen for incoming calls
            newPeer.on('call', handleCall);

            if (pendingHostCallRef) {
                console.log('[PeerJS] Answering pending call!');
                handleCall(pendingHostCallRef);
                pendingHostCallRef = null;
            }

            // Post-open error handling (e.g. peer-unavailable for guests)
            newPeer.on('error', (err) => {
                console.error('[PeerJS] Host runtime error:', err.type, err.message);
                if (err.type === 'peer-unavailable' && useCallStore.getState().status === 'connected') {
                    cleanup();
                } else if (err.type === 'network' || err.type === 'socket-error') {
                    // Try to reconnect instead of instant destroy
                    if (!newPeer.destroyed) {
                        console.log('[PeerJS] Attempting reconnect...');
                        newPeer.reconnect();
                    }
                }
            });

            newPeer.on('disconnected', () => {
                console.log('[PeerJS] Disconnected from signaling server');
                // Only try to reconnect if we haven't cleaned up
                if (!newPeer.destroyed && !isCleaningUpRef) {
                    console.log('[PeerJS] Attempting reconnect...');
                    newPeer.reconnect();
                }
            });

            newPeer.on('close', () => {
                console.log('[PeerJS] Peer connection closed');
                if (!isCleaningUpRef) {
                    cleanup();
                }
            });

        } catch (err: any) {
            console.error('[PeerJS] Init host error:', err);
            const message = err.message === 'SERVER_TIMEOUT' ? 'SERVER_TIMEOUT' : 'CONNECTION_ERROR';
            cleanup();
            setError(message);
            setStatus('error');
        }
    }, [peer, setPeer, setLocalStream, setRemoteStream, setRoomID, setStatus, setError, setPermissionModal, setAudioContext, cleanup, createPeerWithRetry]);

    const initGuest = useCallback(async (hostId: string) => {
        if (peer || useCallStore.getState().status === 'linking') return;

        try {
            setStatus('linking' as any);

            // Android WebView: разблокируем аудио-выход СРАЗУ, ДО любых async/await
            const audioCtx = unlockAudio();
            setAudioContext(audioCtx);

            const stream = await getMediaStream();
            setLocalStream(stream);
            // ── АНАЛИТИКА: mic_allowed (гость выдал доступ к микрофону) ──
            trackEvent('mic_allowed', { room_id: hostId });
            try {
                const hostPeer = await createPeerWithRetry(hostId);
                // Success! The ID was free, so we are the host.
                useCallStore.getState().setIsHost(true);
                setPeer(hostPeer);
                setRoomID(hostId);
                setStatus('waiting');

                hostPeer.on('call', async (call) => {
                    if (currentCallRef) {
                        call.close();
                        return;
                    }
                    try {
                        currentCallRef = call;
                        call.answer(stream);
                        call.on('stream', (remoteStream) => {
                            setRemoteStream(remoteStream);
                            setStatus('connected');
                        });
                        watchIceState(call, () => {
                            console.warn('[ICE] Connection failed on host side');
                            trackEvent('call_failed', { room_id: hostId, reason: 'ICE_FAILED' });
                            cleanup({ error: 'ICE_FAILED', status: 'error' });
                        });
                    } catch (e) {
                        call.close();
                    }
                });

                hostPeer.on('disconnected', () => {
                    hostPeer.reconnect();
                });

                return; // We successfully became the host! Stop here.
            } catch (e: any) {
                if (e && e.type === 'unavailable-id') {
                    // ID is taken! Someone else is the host. We proceed as Guest.
                    console.log("[P2P] ID taken, connecting as Guest...");
                } else {
                    // Bubble up real errors
                    throw e;
                }
            }

            // GUEST LOGIC
            useCallStore.getState().setIsHost(false);

            let newPeer = prewarmedPeerRef;
            if (newPeer && !newPeer.destroyed && newPeer.open) {
                prewarmedPeerRef = null;
            } else {
                if (newPeer) newPeer.destroy();
                newPeer = await createPeerWithRetry();
            }

            setPeer(newPeer);
            setRoomID(hostId);

            let pollingTimer: ReturnType<typeof setTimeout> | null = null;
            let retryCount = 0;

            const connectToHost = () => {
                if (isCleaningUpRef || !newPeer || newPeer.destroyed) return;

                const call = newPeer.call(hostId, stream);
                if (!call) return;

                currentCallRef = call;

                call.on('stream', (remoteStream) => {
                    if (pollingTimer) clearTimeout(pollingTimer);
                    setRemoteStream(remoteStream);
                    setStatus('connected');
                    // ── АНАЛИТИКА: call_started (WebRTC установлен на стороне гостя) ──
                    trackEvent('call_started', { room_id: hostId });
                    remoteStream.getTracks().forEach(track => {
                        track.onended = () => {
                            console.log('[PeerJS] Remote track ended (guest) - hanging up');
                            cleanup();
                        };
                    });
                });

                watchIceState(call, () => {
                    console.warn('[ICE] Connection failed on guest side');
                    trackEvent('call_failed', { room_id: hostId, reason: 'ICE_FAILED' });
                    cleanup({ error: 'ICE_FAILED', status: 'error' });
                });

                call.on('error', (err) => {
                    console.error('[PeerJS] Call error (guest):', err);
                    const currentStatus = useCallStore.getState().status;
                    if (currentStatus === 'connected' || currentStatus === 'waiting') {
                        cleanup();
                    }
                });

                call.on('close', () => {
                    if (useCallStore.getState().status === 'connected') {
                        cleanup();
                    }
                });
            };

            connectToHost();

            // Post-open error handling
            newPeer.on('error', (err) => {
                console.error('[PeerJS] Guest runtime error:', err.type, err.message);
                if (err.type === 'peer-unavailable') {
                    const currentStatus = useCallStore.getState().status;
                    if (currentStatus === 'connected') {
                        cleanup();
                    } else if (retryCount < 4) { // ~12 seconds polling
                        retryCount++;
                        console.log(`[PeerJS] Host not found yet, retrying (attempt ${retryCount})...`);
                        setStatus('linking' as any);
                        pollingTimer = setTimeout(connectToHost, 3000);
                    } else {
                        setError('SERVER_TIMEOUT');
                        setStatus('error');
                        if (!newPeer.destroyed) newPeer.destroy();
                    }
                } else if (err.type === 'network' || err.type === 'socket-error') {
                    if (!newPeer.destroyed) {
                        newPeer.reconnect();
                    }
                }
            });

            newPeer.on('disconnected', () => {
                if (!newPeer.destroyed && !isCleaningUpRef) {
                    newPeer.reconnect();
                }
            });

            newPeer.on('close', () => {
                if (!isCleaningUpRef) {
                    cleanup();
                }
            });

        } catch (err: any) {
            console.error('[PeerJS] Init guest error:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setPermissionModal(true);
            }

            let message = 'CONNECTION_ERROR';
            if (err.message === 'LINK_INVALID' || err?.type === 'peer-unavailable') message = 'LINK_INVALID';
            if (err.message === 'SERVER_TIMEOUT') message = 'SERVER_TIMEOUT';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') message = 'MEDIA_REFUSED';

            cleanup();
            setError(message);
            setStatus('error');
        }
    }, [peer, setPeer, setLocalStream, setRemoteStream, setRoomID, setStatus, setError, setPermissionModal, setAudioContext, cleanup, createPeerWithRetry]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                const currentPeer = useCallStore.getState().peer;
                if (currentPeer && currentPeer.disconnected && !currentPeer.destroyed) {
                    console.log('[PeerJS] App became visible, attempting reconnect...');
                    currentPeer.reconnect();
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            // Cleanup on unmount (only full component unmount)
        };
    }, []);

    return { startHostSession, initGuest, prewarmGuestConnection, prewarmHostConnection, cleanup };
};
