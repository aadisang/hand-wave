"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/utils/trpc";
import inferenceArgs from "./inference_args.json";
import type { CombinedLandmarkerResult } from "./useHolisticLandmarker";

interface PredictionResult {
	text: string;
	confidence: number;
	processingTime: number;
}

const BUFFER_SIZE = 30; // Collect 30 frames (~1 second at 30fps) before inference
const INFERENCE_INTERVAL_MS = 1000; // Run inference every 1 second

/**
 * Hook for continuous ASL prediction from holistic landmarks.
 * Automatically collects frames in a rolling buffer and runs inference periodically.
 */
export function useASLPrediction() {
	const [predictionResult, setPredictionResult] =
		useState<PredictionResult | null>(null);
	const [isActive, setIsActive] = useState(false);

	// Rolling buffer of landmark frames: [num_frames, 390]
	const landmarkFramesRef = useRef<number[][]>([]);
	const lastInferenceTimeRef = useRef<number>(0);
	const isActiveRef = useRef<boolean>(false);

	const predictMutation = trpc.translation.predictFromLandmarks.useMutation({
		onSuccess: (data) => {
			if (data.success && data.text) {
				setPredictionResult({
					text: data.text,
					confidence: data.confidence ?? 0,
					processingTime: data.processingTime ?? 0,
				});
			}
		},
		onError: (error) => {
			console.error("Prediction error:", error);
		},
	});

	const start = useCallback(() => {
		console.log("Starting ASL prediction collection");
		isActiveRef.current = true;
		setIsActive(true);
		landmarkFramesRef.current = [];
		setPredictionResult(null);
		lastInferenceTimeRef.current = 0;
	}, []);

	const stop = useCallback(() => {
		console.log("Stopping ASL prediction collection");
		isActiveRef.current = false;
		setIsActive(false);
		landmarkFramesRef.current = [];
	}, []);

	/**
	 * Extract landmarks and add to rolling buffer.
	 * Automatically triggers inference when buffer is full and interval has elapsed.
	 */
	const addLandmarkFrame = useCallback(
		(result: CombinedLandmarkerResult) => {
			if (!isActiveRef.current) {
				return;
			}

			const selectedColumns = inferenceArgs.selected_columns;
			const landmarkMap = new Map<string, number>();

			// Face landmarks (468 total, 0-indexed)
			if (result.faceLandmarks?.[0]) {
				for (let i = 0; i < result.faceLandmarks[0].length; i++) {
					const lm = result.faceLandmarks[0][i];
					landmarkMap.set(`x_face_${i}`, lm.x);
					landmarkMap.set(`y_face_${i}`, lm.y);
					landmarkMap.set(`z_face_${i}`, lm.z ?? 0);
				}
			}

			// Left hand landmarks (21 total, 0-indexed)
			if (result.leftHandLandmarks?.[0]) {
				for (let i = 0; i < result.leftHandLandmarks[0].length; i++) {
					const lm = result.leftHandLandmarks[0][i];
					landmarkMap.set(`x_left_hand_${i}`, lm.x);
					landmarkMap.set(`y_left_hand_${i}`, lm.y);
					landmarkMap.set(`z_left_hand_${i}`, lm.z ?? 0);
				}
			}

			// Right hand landmarks (21 total, 0-indexed)
			if (result.rightHandLandmarks?.[0]) {
				for (let i = 0; i < result.rightHandLandmarks[0].length; i++) {
					const lm = result.rightHandLandmarks[0][i];
					landmarkMap.set(`x_right_hand_${i}`, lm.x);
					landmarkMap.set(`y_right_hand_${i}`, lm.y);
					landmarkMap.set(`z_right_hand_${i}`, lm.z ?? 0);
				}
			}

			// Pose landmarks (33 total, 0-indexed)
			if (result.poseLandmarks?.[0]) {
				for (let i = 0; i < result.poseLandmarks[0].length; i++) {
					const lm = result.poseLandmarks[0][i];
					landmarkMap.set(`x_pose_${i}`, lm.x);
					landmarkMap.set(`y_pose_${i}`, lm.y);
					landmarkMap.set(`z_pose_${i}`, lm.z ?? 0);
				}
			}

			// Extract values in the exact order specified by selected_columns
			const flatFrame: number[] = [];
			let missingCount = 0;
			for (const colName of selectedColumns) {
				const value = landmarkMap.get(colName);
				if (value === undefined) missingCount++;
				flatFrame.push(value ?? 0); // Use 0 if landmark not detected
			}

			if (flatFrame.length !== 390) {
				console.error(
					`Expected 390 features, got ${flatFrame.length}. Check inference_args.json`,
				);
				return;
			}

			// Log detection stats occasionally
			if (landmarkFramesRef.current.length % 10 === 0) {
				console.log(`Landmark detection: ${390 - missingCount}/390 detected (${missingCount} missing)`);
				console.log(`Hands: L=${result.leftHandLandmarks?.[0] ? 'YES' : 'NO'}, R=${result.rightHandLandmarks?.[0] ? 'YES' : 'NO'}`);
			}

			// Add to rolling buffer
			landmarkFramesRef.current.push(flatFrame);

			// Keep only last BUFFER_SIZE frames
			if (landmarkFramesRef.current.length > BUFFER_SIZE) {
				landmarkFramesRef.current = landmarkFramesRef.current.slice(
					-BUFFER_SIZE,
				);
			}

			// Auto-trigger inference if buffer is full and interval elapsed
			const now = Date.now();
			if (
				landmarkFramesRef.current.length >= BUFFER_SIZE &&
				now - lastInferenceTimeRef.current >= INFERENCE_INTERVAL_MS &&
				!predictMutation.isPending
			) {
				lastInferenceTimeRef.current = now;

				console.log(
					`Auto-inference: ${landmarkFramesRef.current.length} frames`,
				);

				predictMutation.mutate({
					landmarks: landmarkFramesRef.current,
				});
			}
		},
		[predictMutation],
	);

	return {
		isActive,
		start,
		stop,
		addLandmarkFrame,
		predictionResult,
		isLoading: predictMutation.isPending,
		frameCount: landmarkFramesRef.current.length,
	};
}
