"use client";

import { useCallback, useRef } from "react";
import type { CombinedLandmarkerResult } from "./useHolisticLandmarker";
import { usePredictionStore } from "@/stores/prediction-store";

const INFERENCE_INTERVAL_MS = 100; // Run inference every 100ms for snappier response
const CONFIDENCE_THRESHOLD = 0.3; // Only show predictions above 30% confidence
const STABILIZATION_FRAMES = 2; // Require 2 consecutive frames with same prediction to stabilize
const MOTION_THRESHOLD = 0.05; // Skip frames where hand is moving more than 5% (mid-transition)

/**
 * Hook for real-time ASL prediction from hand landmarks.
 * Runs inference on each frame and updates global prediction store.
 */
export function useASLPrediction() {
	const { setPrediction, setActive, setLoading } = usePredictionStore();

	// Current hand landmarks for single-frame inference
	const currentLandmarksRef = useRef<number[][] | null>(null);
	const previousLandmarksRef = useRef<number[][] | null>(null);
	const lastInferenceTimeRef = useRef<number>(0);
	const isActiveRef = useRef<boolean>(false);
	const isPendingRef = useRef<boolean>(false);

	// Prediction stabilization
	const predictionHistoryRef = useRef<string[]>([]);

	// Track request start time for accurate latency measurement
	const requestStartTimeRef = useRef<number>(0);

	/**
	 * Calculate hand motion between frames to detect mid-transition
	 */
	const calculateHandMotion = (current: number[][], previous: number[][]): number => {
		let totalMotion = 0;
		for (let i = 0; i < current.length; i++) {
			const dx = current[i][0] - previous[i][0];
			const dy = current[i][1] - previous[i][1];
			totalMotion += Math.sqrt(dx * dx + dy * dy);
		}
		return totalMotion / current.length; // Average motion per landmark
	};

	/**
	 * Direct HTTP call to Python inference server (bypasses tRPC/Next.js middleware)
	 */
	const runInference = async (landmarks: number[][]) => {
		const startTime = Date.now();
		requestStartTimeRef.current = startTime;
		isPendingRef.current = true;

		try {
			// Direct call to Python FastAPI server
			const response = await fetch("http://localhost:8000/predict", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					landmarks,
					image_width: 1920,
					image_height: 1080,
					mode: "static",
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = await response.json();
			const roundTripTime = Date.now() - startTime;

			console.log("Prediction received:", data.text, "Confidence:", data.confidence, "Latency:", roundTripTime, "ms");

			if (data.text && data.confidence > CONFIDENCE_THRESHOLD) {
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
					setPrediction({
						text: data.text,
						confidence: data.confidence,
						processingTime: roundTripTime,
						topPredictions: data.top_predictions,
					});
				} else {
					setLoading(false);
				}
			} else {
				setLoading(false);
			}
		} catch (error) {
			console.error("Inference error:", error);
			setLoading(false);
		} finally {
			isPendingRef.current = false;
		}
	};

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

			// Detect if hand is moving (mid-transition) - skip inference if so
			let isMoving = false;
			if (previousLandmarksRef.current && previousLandmarksRef.current.length === landmarks2D.length) {
				const motion = calculateHandMotion(landmarks2D, previousLandmarksRef.current);
				isMoving = motion > MOTION_THRESHOLD;
				if (isMoving) {
					console.log(`Hand moving (motion=${motion.toFixed(3)}), skipping inference to avoid mid-transition capture`);
				}
			}

			// Store current landmarks for next frame
			previousLandmarksRef.current = landmarks2D;
			currentLandmarksRef.current = landmarks2D;

			// Auto-trigger inference if interval elapsed AND hand is stable (not moving)
			const now = Date.now();
			const timeSinceLastInference = now - lastInferenceTimeRef.current;

			if (timeSinceLastInference >= INFERENCE_INTERVAL_MS && !isPendingRef.current && !isMoving) {
				lastInferenceTimeRef.current = now;
				setLoading(true);

				console.log(`Running inference on ${handType} hand with ${landmarks2D.length} landmarks`);

				// Run inference directly (bypass tRPC)
				runInference(landmarks2D);
			}
		},
		[setLoading, setPrediction],
	);

	return {
		start,
		stop,
		addLandmarkFrame,
	};
}
