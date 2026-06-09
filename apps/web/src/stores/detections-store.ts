import { create } from "zustand";
import type { DetectionsState } from "@/types/detections";

export const useDetectionsStore = create<DetectionsState>((set) => ({
  currentPrediction: null,
  setCurrentPrediction: (prediction) =>
    set((state) => {
      if (!state.currentPrediction && !prediction) return state;
      if (state.currentPrediction?.text === prediction?.text) return state;
      return { currentPrediction: prediction };
    }),
}));
