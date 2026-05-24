import { create } from "zustand";
import type { DetectionsState } from "@/types/detections";

export const useDetectionsStore = create<DetectionsState>((set) => ({
  currentPrediction: null,
  setCurrentPrediction: (prediction) => set({ currentPrediction: prediction }),
}));
