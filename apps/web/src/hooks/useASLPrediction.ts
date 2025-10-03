"use client";

import { useCallback, useRef } from "react";
import { trpc } from "@/utils/trpc";
import type { CombinedLandmarkerResult } from "./useHolisticLandmarker";
import { usePredictionStore } from "@/stores/prediction-store";

const INFERENCE_INTERVAL_MS = 100; // Run inference every 100ms for snappier response
const CONFIDENCE_THRESHOLD = 0.3; // Only show predictions above 30% confidence
const STABILIZATION_FRAMES = 2; // Require 2 consecutive frames with same prediction to stabilize

/**
 * Hook for real-time ASL prediction from hand landmarks.
 * Runs inference on each frame and updates global prediction store.
 */
export function useASLPrediction() {
	const { setPrediction, setActive, setLoading } = usePredictionStore();

	// Current hand landmarks for single-frame inference
	const currentLandmarksRef = useRef<number[][] | null>(null);
	const lastInferenceTimeRef = useRef<number>(0);
	const isActiveRef = useRef<boolean>(false);

	// Prediction stabilization
	const predictionHistoryRef = useRef<string[]>([]);

	// Track request start time for accurate latency measurement
	const requestStartTimeRef = useRef<number>(0);

	const predictMutation = trpc.translation.predictFromLandmarks.useMutation({
		onSuccess: (data) => {
			// Calculate full round-trip time (client -> server -> client)
			const roundTripTime = Date.now() - requestStartTimeRef.current;
			console.log("Prediction received:", data, "Round-trip:", roundTripTime, "ms");

			if (data.success && data.text && data.confidence !== undefined && data.confidence > CONFIDENCE_THRESHOLD) {
				// Add to prediction history
				predictionHistoryRef.current.push(data.text);

				// Keep only last N predictions
				if (predictionHistoryRef.current.length > STABILIZATION_FRAMES) {
					predictionHistoryRef.current.shift();
				}

				// Check if prediction is stable (same prediction N times in a row)
				const isStable =
					predictionHistoryRef.current.length === STABILIZATION_FRAMES &&
					predictionHistoryRef.current.every((p) => p === data.text);

				// Update display if:
				// 1. Very high confidence (>80%) - immediate update, OR
				// 2. High confidence (>60%), OR
				// 3. Stable across multiple frames
				const shouldUpdate =
					data.confidence > 0.8 ||
					data.confidence > 0.6 ||
					isStable;

				if (shouldUpdate) {
					console.log("Updating store with prediction:", data.text, "confidence:", data.confidence);
					setPrediction({
						text: data.text,
						confidence: data.confidence,
						processingTime: roundTripTime, // Use full round-trip time
						topPredictions: data.topPredictions,
					});
				} else {
					console.log("Prediction not stable enough yet:", predictionHistoryRef.current);
					setLoading(false);
				}
			} else {
				console.log("Prediction did not meet criteria:", {
					success: data.success,
					text: data.text,
					confidence: data.confidence,
					threshold: CONFIDENCE_THRESHOLD,
				});
				setLoading(false);
			}
		},
		onError: (error) => {
			console.error("Prediction error:", error);
			setLoading(false);
		},
	});

	const start = useCallback(() => {
		// Prevent multiple calls
		if (isActiveRef.current) {
			console.log("Already active, skipping start");
			return;
		}

		console.log("Starting real-time ASL prediction");
		isActiveRef.current = true;
		setActive(true);
		currentLandmarksRef.current = null;
		predictionHistoryRef.current = [];
		lastInferenceTimeRef.current = 0;
	}, [setActive]);

	const stop = useCallback(() => {
		// Prevent multiple calls
		if (!isActiveRef.current) {
			console.log("Already stopped, skipping stop");
			return;
		}

		console.log("Stopping ASL prediction");
		isActiveRef.current = false;
		setActive(false);
		currentLandmarksRef.current = null;
		predictionHistoryRef.current = [];
	}, [setActive]);

	/**
	 * Extract hand landmarks and trigger real-time inference.
	 * Uses either left or right hand (whichever is detected).
	 */
	const addLandmarkFrame = useCallback(
		(result: CombinedLandmarkerResult) => {
			if (!isActiveRef.current) {
				return;
			}

			// Extract hand landmarks (prefer right hand, fallback to left)
			let handLandmarks: Array<{ x: number; y: number; z?: number }> | null = null;
			let handType = "none";

			if (result.rightHandLandmarks?.[0]) {
				handLandmarks = result.rightHandLandmarks[0];
				handType = "right";
			} else if (result.leftHandLandmarks?.[0]) {
				handLandmarks = result.leftHandLandmarks[0];
				handType = "left";
			}

			if (!handLandmarks || handLandmarks.length !== 21) {
				// No hand detected, reset prediction history
				if (predictionHistoryRef.current.length > 0) {
					console.log("No hand detected, resetting prediction history");
					predictionHistoryRef.current = [];
					setLoading(false);
				}
				return;
			}

			// Convert to [21, 2] format (x, y coordinates only)
			const landmarks2D: number[][] = handLandmarks.map((lm) => [lm.x, lm.y]);

			// Store current landmarks
			currentLandmarksRef.current = landmarks2D;

			// Auto-trigger inference if interval elapsed
			const now = Date.now();
			const timeSinceLastInference = now - lastInferenceTimeRef.current;

			if (timeSinceLastInference >= INFERENCE_INTERVAL_MS && !predictMutation.isPending) {
				lastInferenceTimeRef.current = now;
				requestStartTimeRef.current = now; // Record request start time
				setLoading(true);

				console.log(`Running inference on ${handType} hand with ${landmarks2D.length} landmarks`);

				// Run inference on single frame
				predictMutation.mutate({
					landmarks: landmarks2D,
				});
			}
		},
		[predictMutation, setLoading],
	);

	return {
		start,
		stop,
		addLandmarkFrame,
	};
}
