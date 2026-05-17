import { create } from "zustand";
import type { Prediction } from "@/types/detections";

type DetectionsState = {
  currentPrediction: Prediction | null;
  setCurrentPrediction: (prediction: Prediction | null) => void;
};

export const useDetectionsStore = create<DetectionsState>((set) => ({
  currentPrediction: null,
  setCurrentPrediction: (prediction) => set({ currentPrediction: prediction }),
}));
