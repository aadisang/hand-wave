/**
 * Local FastAPI inference service client
 */

import type { LandmarkFrame } from "../schema/translation";

const INFERENCE_URL = process.env.INFERENCE_API_URL || "http://localhost:8000";

interface PredictParams {
	landmarks: LandmarkFrame[];
}

interface PredictResult {
	success: boolean;
	text?: string;
	confidence?: number;
	processingTime?: number;
	error?: string;
}

/**
 * Call local inference server to predict ASL text from landmarks
 */
export async function predictFromLandmarks(
	params: PredictParams,
): Promise<PredictResult> {
	try {
		const response = await fetch(`${INFERENCE_URL}/predict`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ landmarks: params.landmarks }),
		});

		if (!response.ok) {
			throw new Error(`Inference API error: ${response.statusText}`);
		}

		const data = await response.json();

		return {
			success: true,
			text: data.text,
			confidence: data.confidence,
			processingTime: data.processing_time,
		};
	} catch (error) {
		console.error("Error calling inference API:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}
