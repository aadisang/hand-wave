import { create } from "zustand";

type LandmarksState = {
  draw: boolean;
  toggleDraw: () => void;
};

export const useLandmarksStore = create<LandmarksState>((set) => ({
  draw: true,
  toggleDraw: () => set((state) => ({ draw: !state.draw })),
}));
