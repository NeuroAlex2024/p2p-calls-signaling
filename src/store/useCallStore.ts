import { create } from 'zustand';
import type { Peer } from 'peerjs';

export type CallStatus = 'idle' | 'linking' | 'waiting' | 'connected' | 'error';

interface CallState {
    peer: Peer | null;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    audioContext: AudioContext | null;
    status: CallStatus;
    roomID: string | null;
    error: string | null;
    isMuted: boolean;
    isRemoteMuted: boolean;
    showPermissionModal: boolean;

    // Actions
    setPeer: (peer: Peer | null) => void;
    setLocalStream: (stream: MediaStream | null) => void;
    setRemoteStream: (stream: MediaStream | null) => void;
    setAudioContext: (ctx: AudioContext | null) => void;
    setStatus: (status: CallStatus) => void;
    setRoomID: (id: string | null) => void;
    setError: (error: string | null) => void;
    setMuted: (isMuted: boolean) => void;
    setRemoteMuted: (isRemoteMuted: boolean) => void;
    setPermissionModal: (show: boolean) => void;
    reset: () => void;
}

export const useCallStore = create<CallState>((set, get) => ({
    peer: null,
    localStream: null,
    remoteStream: null,
    audioContext: null,
    status: 'idle',
    roomID: null,
    error: null,
    isMuted: false,
    isRemoteMuted: false,
    showPermissionModal: false,

    setPeer: (peer) => set({ peer }),
    setLocalStream: (localStream) => set({ localStream }),
    setRemoteStream: (remoteStream) => set({ remoteStream }),
    setAudioContext: (audioContext) => set({ audioContext }),
    setStatus: (status) => set({ status }),
    setRoomID: (roomID) => set({ roomID }),
    setError: (error) => set({ error }),
    setMuted: (isMuted) => set({ isMuted }),
    setRemoteMuted: (isRemoteMuted) => set({ isRemoteMuted }),
    setPermissionModal: (showPermissionModal) => set({ showPermissionModal }),

    reset: () => {
        const { audioContext } = get();
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().catch(() => {});
        }
        set({
            peer: null,
            localStream: null,
            remoteStream: null,
            audioContext: null,
            status: 'idle',
            roomID: null,
            error: null,
            isMuted: false,
            isRemoteMuted: false,
            showPermissionModal: false,
        });
    },
}));
