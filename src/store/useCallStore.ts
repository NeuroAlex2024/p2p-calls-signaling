import { create } from 'zustand';
import type { Peer } from 'peerjs';

export type CallStatus = 'idle' | 'linking' | 'waiting' | 'connected' | 'error';

interface CallState {
    peer: Peer | null;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    status: CallStatus;
    roomID: string | null;
    error: string | null;
    isMuted: boolean;
    isSpeakerOn: boolean;
    showPermissionModal: boolean;

    // Actions
    setPeer: (peer: Peer | null) => void;
    setLocalStream: (stream: MediaStream | null) => void;
    setRemoteStream: (stream: MediaStream | null) => void;
    setStatus: (status: CallStatus) => void;
    setRoomID: (id: string | null) => void;
    setError: (error: string | null) => void;
    setMuted: (isMuted: boolean) => void;
    setSpeakerOn: (isSpeakerOn: boolean) => void;
    setPermissionModal: (show: boolean) => void;
    reset: () => void;
}

export const useCallStore = create<CallState>((set) => ({
    peer: null,
    localStream: null,
    remoteStream: null,
    status: 'idle',
    roomID: null,
    error: null,
    isMuted: false,
    isSpeakerOn: false,
    showPermissionModal: false,

    setPeer: (peer) => set({ peer }),
    setLocalStream: (localStream) => set({ localStream }),
    setRemoteStream: (remoteStream) => set({ remoteStream }),
    setStatus: (status) => set({ status }),
    setRoomID: (roomID) => set({ roomID }),
    setError: (error) => set({ error }),
    setMuted: (isMuted) => set({ isMuted }),
    setSpeakerOn: (isSpeakerOn) => set({ isSpeakerOn }),
    setPermissionModal: (showPermissionModal) => set({ showPermissionModal }),

    reset: () => set({
        peer: null,
        localStream: null,
        remoteStream: null,
        status: 'idle',
        roomID: null,
        error: null,
        isMuted: false,
        isSpeakerOn: false,
        showPermissionModal: false,
    }),
}));
