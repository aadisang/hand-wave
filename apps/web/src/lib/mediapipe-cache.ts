/**
 * Singleton cache for MediaPipe models and WASM runtime.
 * Prevents reloading models every time the camera starts.
 */

import {
	FaceLandmarker,
	FilesetResolver,
	HandLandmarker,
	PoseLandmarker,
} from "@mediapipe/tasks-vision";

interface ModelCache {
	vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null;
	faceLandmarker: FaceLandmarker | null;
	poseLandmarker: PoseLandmarker | null;
	handLandmarker: HandLandmarker | null;
	loading: Promise<void> | null;
}

const cache: ModelCache = {
	vision: null,
	faceLandmarker: null,
	poseLandmarker: null,
	handLandmarker: null,
	loading: null,
};

/**
 * Load and cache MediaPipe models (singleton pattern).
 * Returns cached models if already loaded.
 */
export async function getMediaPipeModels(): Promise<{
	faceLandmarker: FaceLandmarker;
	poseLandmarker: PoseLandmarker;
	handLandmarker: HandLandmarker;
}> {
	// Return cached models if available
	if (cache.faceLandmarker && cache.poseLandmarker && cache.handLandmarker) {
		console.log("Using cached MediaPipe models");
		return {
			faceLandmarker: cache.faceLandmarker,
			poseLandmarker: cache.poseLandmarker,
			handLandmarker: cache.handLandmarker,
		} as {
			faceLandmarker: FaceLandmarker;
			poseLandmarker: PoseLandmarker;
			handLandmarker: HandLandmarker;
		};
	}

	// If already loading, wait for it to complete
	if (cache.loading) {
		console.log("Waiting for MediaPipe models to load...");
		await cache.loading;
		if (
			!cache.faceLandmarker ||
			!cache.poseLandmarker ||
			!cache.handLandmarker
		) {
			throw new Error("MediaPipe models failed to load from cache");
		}
		return {
			faceLandmarker: cache.faceLandmarker,
			poseLandmarker: cache.poseLandmarker,
			handLandmarker: cache.handLandmarker,
		};
	}

	// Start loading
	console.log("Loading MediaPipe models (first time)...");
	cache.loading = (async () => {
		try {
			// Load WASM runtime (cached by browser)
			if (!cache.vision) {
				cache.vision = await FilesetResolver.forVisionTasks(
					"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm",
				);
			}

			// Load models in parallel
			const [faceLandmarker, poseLandmarker, handLandmarker] =
				await Promise.all([
					FaceLandmarker.createFromOptions(cache.vision, {
						baseOptions: {
							modelAssetPath:
								"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
							delegate: "GPU",
						},
						runningMode: "VIDEO",
						numFaces: 1,
						minFaceDetectionConfidence: 0.3,
						minFacePresenceConfidence: 0.3,
						minTrackingConfidence: 0.3,
					} as const satisfies Parameters<
						typeof FaceLandmarker.createFromOptions
					>[1]),
					PoseLandmarker.createFromOptions(cache.vision, {
						baseOptions: {
							modelAssetPath:
								"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
							delegate: "GPU",
						},
						runningMode: "VIDEO",
					} as const satisfies Parameters<
						typeof PoseLandmarker.createFromOptions
					>[1]),
					HandLandmarker.createFromOptions(cache.vision, {
						baseOptions: {
							modelAssetPath:
								"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
							delegate: "GPU",
						},
						runningMode: "VIDEO",
						numHands: 2,
						minHandDetectionConfidence: 0.3,
						minHandPresenceConfidence: 0.3,
						minTrackingConfidence: 0.3,
					} as const satisfies Parameters<
						typeof HandLandmarker.createFromOptions
					>[1]),
				]);

			cache.faceLandmarker = faceLandmarker;
			cache.poseLandmarker = poseLandmarker;
			cache.handLandmarker = handLandmarker;

			console.log("✓ MediaPipe models loaded and cached");
		} catch (error) {
			console.error("Failed to load MediaPipe models:", error);
			throw error;
		} finally {
			cache.loading = null;
		}
	})();

	await cache.loading;

	if (!cache.faceLandmarker || !cache.poseLandmarker || !cache.handLandmarker) {
		throw new Error("MediaPipe models are not available after loading");
	}
	return {
		faceLandmarker: cache.faceLandmarker,
		poseLandmarker: cache.poseLandmarker,
		handLandmarker: cache.handLandmarker,
	};
}

/**
 * Clear the model cache (for cleanup or forced reload).
 */
export function clearMediaPipeCache() {
	cache.faceLandmarker?.close?.();
	cache.poseLandmarker?.close?.();
	cache.handLandmarker?.close?.();

	cache.vision = null;
	cache.faceLandmarker = null;
	cache.poseLandmarker = null;
	cache.handLandmarker = null;
	cache.loading = null;

	console.log("MediaPipe cache cleared");
}
