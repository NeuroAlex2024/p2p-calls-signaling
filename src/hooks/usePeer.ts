import { useEffect, useRef, useCallback } from 'react';
import { Peer } from 'peerjs';
import type { MediaConnection, PeerOptions } from 'peerjs';
import { nanoid } from 'nanoid';
import { useCallStore } from '../store/useCallStore';

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
};

// STUN серверы от нескольких независимых провайдеров — повышают шанс успешного
// ICE candidate gathering при блокировке Google или медленном ответе.
// TURN не используется: соединение только прямое P2P.
const ICE_SERVERS: RTCIceServer[] = [
    // Google (5 серверов)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Cloudflare
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Mozilla / Standard STUN
    { urls: 'stun:stun.stunprotocol.org:3478' },
    // Nextcloud (независимый)
    { urls: 'stun:stun.nextcloud.com:443' },
    // Freie Universität Berlin
    { urls: 'stun:stun.fu-berlin.de:3478' },
];

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000; // ms
const CONNECTION_TIMEOUT = 12000; // ms

/**
 * Подписывается на iceConnectionState у MediaConnection.
 * - 'failed'      → немедленно вызывает onFailed (звонок невозможен)
 * - 'disconnected'→ запускает таймер: если через 5 с не восстановился → onFailed
 */
function watchIceState(call: MediaConnection, onFailed: () => void): () => void {
    const pc = call.peerConnection as RTCPeerConnection | undefined;
    if (!pc) return () => {};

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

        if (state === 'failed') {
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

export const usePeer = () => {
    const {
        peer,
        setPeer,
        setLocalStream,
        setRemoteStream,
        setStatus,
        setRoomID,
        setError,
        setPermissionModal,
        reset,
    } = useCallStore();

    const currentCallRef = useRef<MediaConnection | null>(null);
    const retriesRef = useRef(0);
    const isCleaningUpRef = useRef(false);

    const cleanup = useCallback(() => {
        if (isCleaningUpRef.current) return;
        isCleaningUpRef.current = true;

        if (currentCallRef.current) {
            currentCallRef.current.close();
            currentCallRef.current = null;
        }

        const currentPeer = useCallStore.getState().peer;
        if (currentPeer && !currentPeer.destroyed) {
            currentPeer.destroy();
        }

        reset();
        retriesRef.current = 0;
        isCleaningUpRef.current = false;
    }, [reset]);

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
                        retriesRef.current = 0;
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

    const initHost = useCallback(async () => {
        if (peer) return;

        try {
            setStatus('linking' as any);
            const id = nanoid(7);

            const newPeer = await createPeerWithRetry(id);
            setPeer(newPeer);
            setRoomID(newPeer.id);
            setStatus('waiting');

            // Listen for incoming calls
            newPeer.on('call', async (call) => {
                if (currentCallRef.current) {
                    call.close();
                    return;
                }

                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
                    setLocalStream(stream);

                    currentCallRef.current = call;
                    call.answer(stream);

                    call.on('stream', (remoteStream) => {
                        setRemoteStream(remoteStream);
                        setStatus('connected');
                    });

                    // Мониторинг ICE: если соединение упало — завершаем звонок с ошибкой
                    watchIceState(call, () => {
                        console.warn('[ICE] Connection failed on host side');
                        setError('ICE_FAILED');
                        cleanup();
                    });

                    call.on('close', () => {
                        cleanup();
                    });

                    call.on('error', (err) => {
                        console.error('[PeerJS] Call error (host):', err);
                        cleanup();
                    });
                } catch (mediaErr: any) {
                    console.error('[PeerJS] Media error:', mediaErr);
                    if (mediaErr.name === 'NotAllowedError' || mediaErr.name === 'PermissionDeniedError') {
                        setPermissionModal(true);
                    }
                    call.close();
                }
            });

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
                if (!newPeer.destroyed && !isCleaningUpRef.current) {
                    console.log('[PeerJS] Attempting reconnect...');
                    newPeer.reconnect();
                }
            });

            newPeer.on('close', () => {
                console.log('[PeerJS] Peer connection closed');
                if (!isCleaningUpRef.current) {
                    cleanup();
                }
            });

        } catch (err: any) {
            console.error('[PeerJS] Init host error:', err);
            const message = err.message === 'SERVER_TIMEOUT' ? 'SERVER_TIMEOUT' : 'CONNECTION_ERROR';
            setError(message);
            setStatus('error');
        }
    }, [peer, setPeer, setLocalStream, setRemoteStream, setRoomID, setStatus, setError, setPermissionModal, cleanup, createPeerWithRetry]);

    const initGuest = useCallback(async (hostId: string) => {
        if (peer) return;

        try {
            setStatus('linking' as any);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
            setLocalStream(stream);

            const newPeer = await createPeerWithRetry();
            setPeer(newPeer);
            setRoomID(hostId);

            const call = newPeer.call(hostId, stream);
            if (!call) {
                throw new Error('LINK_INVALID');
            }
            currentCallRef.current = call;

            call.on('stream', (remoteStream) => {
                setRemoteStream(remoteStream);
                setStatus('connected');
            });

            // Мониторинг ICE: если соединение упало — завершаем звонок с ошибкой
            watchIceState(call, () => {
                console.warn('[ICE] Connection failed on guest side');
                setError('ICE_FAILED');
                cleanup();
            });

            call.on('error', (err) => {
                console.error('[PeerJS] Call error (guest):', err);
                const currentStatus = useCallStore.getState().status;
                if (currentStatus === 'connected' || currentStatus === 'waiting') {
                    cleanup();
                } else {
                    setError('CONNECTION_ERROR');
                    setStatus('error');
                }
            });

            call.on('close', () => {
                cleanup();
            });

            // Post-open error handling
            newPeer.on('error', (err) => {
                console.error('[PeerJS] Guest runtime error:', err.type, err.message);
                if (err.type === 'peer-unavailable') {
                    const currentStatus = useCallStore.getState().status;
                    if (currentStatus === 'connected' || currentStatus === 'waiting') {
                        cleanup();
                    } else {
                        setError('LINK_INVALID');
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
                if (!newPeer.destroyed && !isCleaningUpRef.current) {
                    newPeer.reconnect();
                }
            });

            newPeer.on('close', () => {
                if (!isCleaningUpRef.current) {
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

            setError(message);
            setStatus('error');
        }
    }, [peer, setPeer, setLocalStream, setRemoteStream, setRoomID, setStatus, setError, setPermissionModal, cleanup, createPeerWithRetry]);

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

    return { initHost, initGuest, cleanup };
};
