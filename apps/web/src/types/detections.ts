export type Prediction = {
  text: string;
  confidence: number;
  processingTimeMs: number;
  committed: boolean;
};

export type DetectionsState = {
  currentPrediction: Prediction | null;
  setCurrentPrediction: (prediction: Prediction | null) => void;
};
