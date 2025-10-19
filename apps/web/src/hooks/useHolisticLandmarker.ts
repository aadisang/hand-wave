"use client";

import type {
	FaceLandmarker,
	FaceLandmarkerResult,
	HandLandmarker,
	HandLandmarkerResult,
	PoseLandmarker,
	PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMediaPipeModels } from "@/lib/mediapipe-cache";

type StartOptions = {
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	mirror?: boolean;
	onLandmarksDetected?: (result: CombinedLandmarkerResult) => void;
};

export interface CombinedLandmarkerResult {
	faceLandmarks: FaceLandmarkerResult["faceLandmarks"];
	poseLandmarks: PoseLandmarkerResult["landmarks"];
	leftHandLandmarks: HandLandmarkerResult["landmarks"];
	rightHandLandmarks: HandLandmarkerResult["landmarks"];
}

// Hand connection edges
const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4],
	[0, 5],
	[5, 6],
	[6, 7],
	[7, 8],
	[0, 9],
	[9, 10],
	[10, 11],
	[11, 12],
	[0, 13],
	[13, 14],
	[14, 15],
	[15, 16],
	[0, 17],
	[17, 18],
	[18, 19],
	[19, 20],
	[5, 9],
	[9, 13],
	[13, 17],
];

/**
 * React hook that combines Face, Pose, and Hand landmarkers to create a holistic solution.
 * This is needed because the unified HolisticLandmarker model is not yet available in MediaPipe Tasks.
 */
export function useHolisticLandmarker() {
	const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
	const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
	const handLandmarkerRef = useRef<HandLandmarker | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const runningRef = useRef(false);
	const lastVideoTimeRef = useRef(-1);
	const [ready, setReady] = useState(false);
	const onLandmarksDetectedRef = useRef<
		((result: CombinedLandmarkerResult) => void) | null
	>(null);

	// Initialize all three landmarkers using cached singleton
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				// Get cached models (instant on subsequent loads)
				const { faceLandmarker, poseLandmarker, handLandmarker } =
					await getMediaPipeModels();

				if (cancelled) {
					return;
				}

				faceLandmarkerRef.current = faceLandmarker;
				poseLandmarkerRef.current = poseLandmarker;
				handLandmarkerRef.current = handLandmarker;
				setReady(true);
			} catch (error) {
				console.error("Failed to initialize landmarkers:", error);
				setReady(false);
			}
		})();

		return () => {
			cancelled = true;
			runningRef.current = false;

			if (animationFrameRef.current != null) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}

			// Don't close models - they're cached for reuse
			faceLandmarkerRef.current = null;
			poseLandmarkerRef.current = null;
			handLandmarkerRef.current = null;
		};
	}, []);

	const stop = useCallback(() => {
		runningRef.current = false;
		if (animationFrameRef.current != null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
	}, []);

	const drawResults = useCallback(
		(
			results: CombinedLandmarkerResult,
			ctx: CanvasRenderingContext2D,
			canvas: HTMLCanvasElement,
			video: HTMLVideoElement,
			mirror: boolean,
		) => {
			const dpr = window.devicePixelRatio || 1;
			const cssWidth = Math.round(canvas.clientWidth);
			const cssHeight = Math.round(canvas.clientHeight);
			if (
				canvas.width !== cssWidth * dpr ||
				canvas.height !== cssHeight * dpr
			) {
				canvas.width = cssWidth * dpr;
				canvas.height = cssHeight * dpr;
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			ctx.clearRect(0, 0, cssWidth, cssHeight);

			const videoWidth = video.videoWidth;
			const videoHeight = video.videoHeight;
			if (!videoWidth || !videoHeight) return;

			const canvasAspect = cssWidth / cssHeight;
			const videoAspect = videoWidth / videoHeight;
			let drawWidth: number;
			let drawHeight: number;
			if (videoAspect > canvasAspect) {
				drawWidth = cssWidth;
				drawHeight = cssWidth / videoAspect;
			} else {
				drawHeight = cssHeight;
				drawWidth = cssHeight * videoAspect;
			}
			const offsetX = (cssWidth - drawWidth) / 2;
			const offsetY = (cssHeight - drawHeight) / 2;

			const mapX = (x: number) => offsetX + (mirror ? 1 - x : x) * drawWidth;
			const mapY = (y: number) => offsetY + y * drawHeight;

			// Draw left hand
			if (results.leftHandLandmarks && results.leftHandLandmarks.length > 0) {
				const landmarks = results.leftHandLandmarks[0];
				ctx.strokeStyle = "rgba(0, 255, 0, 0.9)";
				ctx.lineWidth = 2;
				for (const [a, b] of HAND_CONNECTIONS) {
					const A = landmarks[a];
					const B = landmarks[b];
					if (!A || !B) continue;
					ctx.beginPath();
					ctx.moveTo(mapX(A.x), mapY(A.y));
					ctx.lineTo(mapX(B.x), mapY(B.y));
					ctx.stroke();
				}

				ctx.fillStyle = "rgba(255, 0, 0, 0.9)";
				for (const lm of landmarks) {
					ctx.beginPath();
					ctx.arc(mapX(lm.x), mapY(lm.y), 3, 0, Math.PI * 2);
					ctx.fill();
				}
			}

			// Draw right hand
			if (results.rightHandLandmarks && results.rightHandLandmarks.length > 0) {
				const landmarks = results.rightHandLandmarks[0];
				ctx.strokeStyle = "rgba(0, 255, 255, 0.9)";
				ctx.lineWidth = 2;
				for (const [a, b] of HAND_CONNECTIONS) {
					const A = landmarks[a];
					const B = landmarks[b];
					if (!A || !B) continue;
					ctx.beginPath();
					ctx.moveTo(mapX(A.x), mapY(A.y));
					ctx.lineTo(mapX(B.x), mapY(B.y));
					ctx.stroke();
				}

				ctx.fillStyle = "rgba(255, 255, 0, 0.9)";
				for (const lm of landmarks) {
					ctx.beginPath();
					ctx.arc(mapX(lm.x), mapY(lm.y), 3, 0, Math.PI * 2);
					ctx.fill();
				}
			}

			// Draw face landmarks (simplified)
			if (results.faceLandmarks && results.faceLandmarks.length > 0) {
				ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
				for (const lm of results.faceLandmarks[0]) {
					ctx.beginPath();
					ctx.arc(mapX(lm.x), mapY(lm.y), 1, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		},
		[],
	);

	const start = useCallback(
		({
			video,
			canvas,
			mirror = false,
			onLandmarksDetected,
		}: StartOptions): (() => void) | undefined => {
			const faceLm = faceLandmarkerRef.current;
			const poseLm = poseLandmarkerRef.current;
			const handLm = handLandmarkerRef.current;
			if (!faceLm || !poseLm || !handLm) return;

			onLandmarksDetectedRef.current = onLandmarksDetected || null;

			faceLm.setOptions?.({ runningMode: "VIDEO" }).catch(() => {});
			poseLm.setOptions?.({ runningMode: "VIDEO" }).catch(() => {});
			handLm.setOptions?.({ runningMode: "VIDEO" }).catch(() => {});

			runningRef.current = true;

			const ctx = canvas.getContext("2d", { willReadFrequently: false });
			if (!ctx) return;

			// Create a temporary canvas for preprocessing
			const preprocessCanvas = document.createElement("canvas");
			const preprocessCtx = preprocessCanvas.getContext("2d", {
				willReadFrequently: false,
			});
			if (!preprocessCtx) return;

			// Note: We intentionally avoid WebGL context listeners here since we're
			// using a 2D canvas context. Adding WebGL listeners on a 2D context is
			// unnecessary and can be misleading.

			const loop = () => {
				if (!runningRef.current) return;

				if (!video.videoWidth || !video.videoHeight) {
					animationFrameRef.current = requestAnimationFrame(loop);
					return;
				}

				const now = performance.now();

				if (lastVideoTimeRef.current !== video.currentTime) {
					lastVideoTimeRef.current = video.currentTime;
					try {
						// Preprocess video frame for better detection in poor lighting
						preprocessCanvas.width = video.videoWidth;
						preprocessCanvas.height = video.videoHeight;

						// Draw original frame
						preprocessCtx.drawImage(video, 0, 0);

						// Apply brightness and contrast adjustments
						const imageData = preprocessCtx.getImageData(
							0,
							0,
							preprocessCanvas.width,
							preprocessCanvas.height,
						);
						const data = imageData.data;

						// Brightness: +20, Contrast: 1.2
						const brightness = 20;
						const contrast = 1.2;
						const factor =
							(259 * (contrast * 100 + 255)) / (255 * (259 - contrast * 100));

						for (let i = 0; i < data.length; i += 4) {
							// Apply contrast and brightness to RGB channels
							data[i] = factor * (data[i] - 128) + 128 + brightness;
							data[i + 1] = factor * (data[i + 1] - 128) + 128 + brightness;
							data[i + 2] = factor * (data[i + 2] - 128) + 128 + brightness;
						}

						preprocessCtx.putImageData(imageData, 0, 0);

						// Run all three detectors on preprocessed frame
						const faceResults = faceLm.detectForVideo(preprocessCanvas, now);
						const poseResults = poseLm.detectForVideo(preprocessCanvas, now);
						const handResults = handLm.detectForVideo(preprocessCanvas, now);

						// Separate hands by handedness
						const leftHand = [];
						const rightHand = [];
						for (let i = 0; i < handResults.landmarks.length; i++) {
							const handedness = handResults.handedness[i]?.[0]?.categoryName;
							if (handedness === "Left") {
								leftHand.push(handResults.landmarks[i]);
							} else if (handedness === "Right") {
								rightHand.push(handResults.landmarks[i]);
							}
						}

						// Combine results
						const combinedResults: CombinedLandmarkerResult = {
							faceLandmarks: faceResults.faceLandmarks,
							poseLandmarks: poseResults.landmarks,
							leftHandLandmarks: leftHand,
							rightHandLandmarks: rightHand,
						};

						drawResults(combinedResults, ctx, canvas, video, mirror);

						if (onLandmarksDetectedRef.current) {
							onLandmarksDetectedRef.current(combinedResults);
						}
					} catch (error) {
						console.error("Error during landmark detection:", error);
					}
				}

				animationFrameRef.current = requestAnimationFrame(loop);
			};

			if (video.readyState >= 2) {
				loop();
			} else {
				const onLoaded = () => {
					video.removeEventListener("loadeddata", onLoaded);
					loop();
				};
				video.addEventListener("loadeddata", onLoaded);
			}

			return () => {
				runningRef.current = false;
			};
		},
		[drawResults],
	);

	return {
		ready,
		start,
		stop,
	};
}
