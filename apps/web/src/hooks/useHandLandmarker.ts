"use client";

import {
	FilesetResolver,
	HandLandmarker,
	type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";

type StartOptions = {
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	mirror?: boolean;
};

// Edges connecting the 21 MediaPipe hand landmarks
const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
	// Palm connections
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4], // Thumb
	[0, 5],
	[5, 6],
	[6, 7],
	[7, 8], // Index
	[0, 9],
	[9, 10],
	[10, 11],
	[11, 12], // Middle
	[0, 13],
	[13, 14],
	[14, 15],
	[15, 16], // Ring
	[0, 17],
	[17, 18],
	[18, 19],
	[19, 20], // Pinky
	// Cross-palm connections
	[5, 9],
	[9, 13],
	[13, 17],
];

export function useHandLandmarker() {
	const landmarkerRef = useRef<HandLandmarker | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const runningRef = useRef(false);
	const lastVideoTimeRef = useRef(-1);
	const [ready, setReady] = useState(false);

	// Initialize the HandLandmarker once on mount
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const vision = await FilesetResolver.forVisionTasks(
					// Align the wasm CDN version with the installed package version to avoid mismatches
					"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm",
				);
				const handLandmarker = await HandLandmarker.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath:
							"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
						delegate: "GPU",
					},
					runningMode: "VIDEO",
					numHands: 2,
				});
				if (cancelled) {
					handLandmarker.close?.();
					return;
				}
				landmarkerRef.current = handLandmarker;
				setReady(true);
			} catch {
				setReady(false);
			}
		})();

		return () => {
			// Cleanup
			runningRef.current = false;

			if (animationFrameRef.current != null) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}

			landmarkerRef.current?.close?.();
			landmarkerRef.current = null;
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
			results: HandLandmarkerResult,
			ctx: CanvasRenderingContext2D,
			canvas: HTMLCanvasElement,
			video: HTMLVideoElement,
			mirror: boolean,
		) => {
			// Use CSS pixels for drawing coordinates (handle HiDPI via setTransform)
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

			// Compute letterbox offsets for object-contain fit
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

			const strokeStyle = "rgba(0, 255, 0, 0.9)";
			const fillStyle = "rgba(255, 0, 0, 0.9)";

			if (results.landmarks) {
				for (const landmarks of results.landmarks) {
					// Draw connections
					ctx.strokeStyle = strokeStyle;
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

					// Draw keypoints
					ctx.fillStyle = fillStyle;
					for (const lm of landmarks) {
						ctx.beginPath();
						ctx.arc(mapX(lm.x), mapY(lm.y), 3, 0, Math.PI * 2);
						ctx.fill();
					}
				}
			}
		},
		[],
	);

	const start = useCallback(
		({ video, canvas, mirror = false }: StartOptions) => {
			const lm = landmarkerRef.current;
			if (!lm) return;

			// Ensure running mode is VIDEO
			lm.setOptions?.({ runningMode: "VIDEO" }).catch(() => {});

			runningRef.current = true;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			const loop = () => {
				if (!runningRef.current) return;

				if (!video.videoWidth || !video.videoHeight) {
					animationFrameRef.current = requestAnimationFrame(loop);
					return;
				}

				const now = performance.now();

				if (lastVideoTimeRef.current !== video.currentTime) {
					lastVideoTimeRef.current = video.currentTime;
					const results = lm.detectForVideo(video, now);
					drawResults(results, ctx, canvas, video, mirror);
				}

				animationFrameRef.current = requestAnimationFrame(loop);
			};

			// Kick off the loop
			if (video.readyState >= 2) {
				loop();
			} else {
				const onLoaded = () => {
					video.removeEventListener("loadeddata", onLoaded);
					loop();
				};
				video.addEventListener("loadeddata", onLoaded);
			}
		},
		[drawResults],
	);

	return {
		ready,
		start,
		stop,
	};
}
