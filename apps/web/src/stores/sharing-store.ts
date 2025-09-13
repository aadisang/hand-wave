import { create } from "zustand";

type StreamType = "screen" | "camera" | null;

interface SharingState {
	isSharing: boolean;
	streamType: StreamType;
	startScreenShare: () => void;
	startCamera: () => void;
	stopSharing: () => void;
}

export const useSharingStore = create<SharingState>((set) => ({
	isSharing: false,
	streamType: null,

	startScreenShare: () => set({ isSharing: true, streamType: "screen" }),
	startCamera: () => set({ isSharing: true, streamType: "camera" }),
	stopSharing: () => set({ isSharing: false, streamType: null }),
}));
