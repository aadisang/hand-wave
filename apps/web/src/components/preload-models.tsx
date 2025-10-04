"use client";

import { useEffect } from "react";
import { getMediaPipeModels } from "@/lib/mediapipe-cache";

/**
 * Preloads MediaPipe models in the background on app start.
 * This ensures models are cached before the user starts the camera.
 */
export function PreloadModels() {
	useEffect(() => {
		// Start loading models in the background immediately
		getMediaPipeModels().catch((error) => {
			console.error("Failed to preload models:", error);
		});
	}, []);

	return null; // This component doesn't render anything
}
