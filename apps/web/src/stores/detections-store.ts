import { create } from "zustand";

export type Prediction = {
  text: string;
  confidence: number;
  processingTimeMs: number;
};

export type HistoryItem = Prediction & {
  id: string;
  timestamp: Date;
};

const maxHistoryItems = 20;

type DetectionsState = {
  currentPrediction: Prediction | null;
  history: HistoryItem[];
  setCurrentPrediction: (prediction: Prediction | null) => void;
  pushPrediction: (prediction: Prediction) => void;
  clearHistory: () => void;
};

export const useDetectionsStore = create<DetectionsState>((set) => ({
  currentPrediction: null,
  history: [],

  setCurrentPrediction: (prediction) => set({ currentPrediction: prediction }),

  pushPrediction: (prediction) =>
    set((state) => {
      const last = state.history[0];
      const item: HistoryItem = {
        ...prediction,
        id: crypto.randomUUID(),
        timestamp: new Date(),
      };

      return {
        currentPrediction: prediction,
        history:
          last?.text === prediction.text
            ? state.history
            : [item, ...state.history].slice(0, maxHistoryItems),
      };
    }),

  clearHistory: () => set({ history: [] }),
}));
