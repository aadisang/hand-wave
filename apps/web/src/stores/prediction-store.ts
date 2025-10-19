import { create } from "zustand";

export interface PredictionResult {
	text: string;
	confidence: number;
	processingTime: number;
	topPredictions?: Array<{ label: string; confidence: number }>;
}

export interface PredictionHistoryItem {
	id: string;
	text: string;
	confidence: number;
	processingTime: number;
	timestamp: Date;
}

interface PredictionState {
	// Current prediction
	currentPrediction: PredictionResult | null;

	// History (last 20 detections)
	history: PredictionHistoryItem[];

	// Status
	isActive: boolean;
	isLoading: boolean;

	// Actions
	setPrediction: (prediction: PredictionResult) => void;
	addToHistory: (
		text: string,
		confidence: number,
		processingTime: number,
	) => void;
	clearHistory: () => void;
	setActive: (active: boolean) => void;
	setLoading: (loading: boolean) => void;
	reset: () => void;
}

export const usePredictionStore = create<PredictionState>((set, get) => ({
	currentPrediction: null,
	history: [],
	isActive: false,
	isLoading: false,

	setPrediction: (prediction: PredictionResult) => {
		const { text, confidence, processingTime } = prediction;

		set({ currentPrediction: prediction, isLoading: false });

		// Add to history
		get().addToHistory(text, confidence, processingTime);
	},

	addToHistory: (text: string, confidence: number, processingTime: number) => {
		const state = get();

		// Only add if different from the most recent sign (ignore confidence differences)
		if (state.history.length > 0 && state.history[0].text === text) {
			return; // Skip duplicate sign
		}

		const newItem: PredictionHistoryItem = {
			id: `${Date.now()}-${Math.random()}`,
			text,
			confidence,
			processingTime,
			timestamp: new Date(),
		};

		set((state) => ({
			history: [newItem, ...state.history].slice(0, 20), // Keep last 20
		}));
	},

	clearHistory: () => set({ history: [] }),

	setActive: (active: boolean) =>
		set({
			isActive: active,
			...(active ? {} : { currentPrediction: null, isLoading: false }),
		}),

	setLoading: (loading: boolean) => set({ isLoading: loading }),

	reset: () =>
		set({
			currentPrediction: null,
			history: [],
			isActive: false,
			isLoading: false,
		}),
}));
