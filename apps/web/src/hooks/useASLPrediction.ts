"use client";

import { useCallback, useRef, useState } from "react";
import { trpc } from "@/utils/trpc";
import inferenceArgs from "./inference_args.json";
import type { CombinedLandmarkerResult } from "./useHolisticLandmarker";

interface PredictionResult {
	text: string;
	confidence: number;
	processingTime: number;
}

// Parse selected columns from inference_args.json
// Format: "x_face_0", "x_left_hand_0", "x_right_hand_0", "x_pose_12", etc.
function parseColumnName(col: string): {
	coord: "x" | "y" | "z";
	part: "face" | "left_hand" | "right_hand" | "pose";
	index: number;
} {
	const [coord, part, idx] = col.split("_");
	const index = Number.parseInt(
		part === "hand"
			? col.split("_")[2]
			: col.split("_")[col.split("_").length - 1],
		10,
	);

	// Handle the part name
	let partName: "face" | "left_hand" | "right_hand" | "pose";
	if (col.includes("left_hand")) {
		partName = "left_hand";
	} else if (col.includes("right_hand")) {
		partName = "right_hand";
	} else if (col.includes("face")) {
		partName = "face";
	} else {
		partName = "pose";
	}

	return {
		coord: coord as "x" | "y" | "z",
		part: partName,
		index,
	};
}

/**
 * Hook for collecting holistic landmarks and sending them to the inference API for ASL prediction.
 */
export function useASLPrediction() {
	const [isCollecting, setIsCollecting] = useState(false);
	const [predictionResult, setPredictionResult] =
		useState<PredictionResult | null>(null);

	// Store flat landmark frames: [num_frames, 390]
	const landmarkFramesRef = useRef<number[][]>([]);

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

	const startCollecting = useCallback(() => {
		setIsCollecting(true);
		landmarkFramesRef.current = [];
		setPredictionResult(null);
	}, []);

	const stopCollecting = useCallback(() => {
		setIsCollecting(false);
		landmarkFramesRef.current = [];
	}, []);

	/**
	 * Extract the 130 specific landmarks from CombinedLandmarkerResult and flatten to [390].
	 */
	const addLandmarkFrame = useCallback(
		(result: CombinedLandmarkerResult) => {
			if (!isCollecting) return;

			// Create storage for all coordinates organized by landmark
			// We need to build a flat array of 390 values in the order specified by inference_args.json
			const selectedColumns = inferenceArgs.selected_columns;

			// Build a map of available landmarks
			const landmarkMap = new Map<string, number>();

			// Face landmarks (468 total, 0-indexed)
			if (result.faceLandmarks && result.faceLandmarks[0]) {
				for (let i = 0; i < result.faceLandmarks[0].length; i++) {
					const lm = result.faceLandmarks[0][i];
					landmarkMap.set(`x_face_${i}`, lm.x);
					landmarkMap.set(`y_face_${i}`, lm.y);
					landmarkMap.set(`z_face_${i}`, lm.z ?? 0);
				}
			}

			// Left hand landmarks (21 total, 0-indexed)
			if (result.leftHandLandmarks && result.leftHandLandmarks[0]) {
				for (let i = 0; i < result.leftHandLandmarks[0].length; i++) {
					const lm = result.leftHandLandmarks[0][i];
					landmarkMap.set(`x_left_hand_${i}`, lm.x);
					landmarkMap.set(`y_left_hand_${i}`, lm.y);
					landmarkMap.set(`z_left_hand_${i}`, lm.z ?? 0);
				}
			}

			// Right hand landmarks (21 total, 0-indexed)
			if (result.rightHandLandmarks && result.rightHandLandmarks[0]) {
				for (let i = 0; i < result.rightHandLandmarks[0].length; i++) {
					const lm = result.rightHandLandmarks[0][i];
					landmarkMap.set(`x_right_hand_${i}`, lm.x);
					landmarkMap.set(`y_right_hand_${i}`, lm.y);
					landmarkMap.set(`z_right_hand_${i}`, lm.z ?? 0);
				}
			}

			// Pose landmarks (33 total, 0-indexed)
			if (result.poseLandmarks && result.poseLandmarks[0]) {
				for (let i = 0; i < result.poseLandmarks[0].length; i++) {
					const lm = result.poseLandmarks[0][i];
					landmarkMap.set(`x_pose_${i}`, lm.x);
					landmarkMap.set(`y_pose_${i}`, lm.y);
					landmarkMap.set(`z_pose_${i}`, lm.z ?? 0);
				}
			}

			// Extract values in the exact order specified by selected_columns
			const flatFrame: number[] = [];
			for (const colName of selectedColumns) {
				const value = landmarkMap.get(colName);
				flatFrame.push(value ?? 0); // Use 0 if landmark not detected
			}

			if (flatFrame.length !== 390) {
				console.error(
					`Expected 390 features, got ${flatFrame.length}. Check inference_args.json`,
				);
				return;
			}

			landmarkFramesRef.current.push(flatFrame);
		},
		[isCollecting],
	);

	const predict = useCallback(() => {
		const frames = landmarkFramesRef.current;

		if (frames.length === 0) {
			console.warn("No landmark frames collected");
			return;
		}

		console.log(
			`Sending ${frames.length} frames (${frames[0]?.length} features each) for prediction`,
		);

		predictMutation.mutate({
			landmarks: frames,
		});

		landmarkFramesRef.current = [];
	}, [predictMutation]);

	return {
		isCollecting,
		startCollecting,
		stopCollecting,
		addLandmarkFrame,
		predict,
		predictionResult,
		isLoading: predictMutation.isPending,
		frameCount: landmarkFramesRef.current.length,
	};
}
