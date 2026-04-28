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
  pushPrediction: (prediction: Prediction) => void;
  clearHistory: () => void;
};

const seedHistory = (): HistoryItem[] => {
  const now = Date.now();
  const samples: Array<[string, number, number, number]> = [
    ["Hello", 0.97, 42, 4_000],
    ["Thank you", 0.91, 58, 12_500],
    ["Yes", 0.88, 36, 24_000],
    ["Please", 0.83, 49, 41_000],
    ["I love you", 0.95, 53, 67_000],
  ];

  return samples.map(([text, confidence, processingTimeMs, ago], i) => ({
    id: `seed-${i}`,
    text,
    confidence,
    processingTimeMs,
    timestamp: new Date(now - ago),
  }));
};

export const useDetectionsStore = create<DetectionsState>((set) => ({
  currentPrediction: null,
  history: seedHistory(),

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
