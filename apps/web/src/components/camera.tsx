"use client";
import { useEffect, useRef } from "react";
import Webcam from "react-webcam";
import { useASLPrediction } from "@/hooks/useASLPrediction";
import { useHolisticLandmarker } from "@/hooks/useHolisticLandmarker";
import { useSharingStore } from "@/stores/sharing-store";

interface CameraProps {
	onStreamStop: () => void;
}

/**
 * Renders a webcam feed with a canvas overlay and starts holistic landmark processing.
 *
 * Uses MediaPipe HolisticLandmarker to detect face, pose, and hand landmarks needed
 * for ASL fingerspelling recognition. Collected landmarks are sent to the ASL prediction hook.
 *
 * @param onStreamStop - Callback invoked when the camera stream fails or is stopped due to a user-media error.
 * @returns The Camera React element.
 */
export function Camera({ onStreamStop }: CameraProps) {
	const webcamRef = useRef<Webcam>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { stopSharing } = useSharingStore();
	const { ready, start, stop } = useHolisticLandmarker();
	const { addLandmarkFrame, start: startPrediction } = useASLPrediction();

	const videoConstraints = {
		width: 1280,
		height: 720,
		facingMode: "user",
	};

	useEffect(() => {
		const videoEl = webcamRef.current?.video as HTMLVideoElement | undefined;
		const canvasEl = canvasRef.current ?? undefined;
		if (!ready || !videoEl || !canvasEl) return;

		// Start continuous prediction when camera starts
		startPrediction();

		// Size canvas to container via CSS; drawing code will handle DPR and letterboxing
		const resize = () => {
			if (!canvasEl?.parentElement) return;
			const { clientWidth, clientHeight } = canvasEl.parentElement;
			canvasEl.style.width = `${clientWidth}px`;
			canvasEl.style.height = `${clientHeight}px`;
		};
		resize();
		const ro = new ResizeObserver(resize);
		if (canvasEl.parentElement) ro.observe(canvasEl.parentElement);

		// Mirror is true for camera feeds to create a natural "looking at yourself" experience
		const cleanupStart = start({
			video: videoEl,
			canvas: canvasEl,
			mirror: true,
			onLandmarksDetected: (result) => {
				// Continuously collect landmarks for automatic inference
				addLandmarkFrame(result);
			},
		});

		return () => {
			ro.disconnect();
			cleanupStart?.();
			stop();
		};
	}, [ready, start, stop, addLandmarkFrame, startPrediction]);

	return (
		<div className="w-full h-full relative">
			<Webcam
				ref={webcamRef}
				audio={false}
				videoConstraints={videoConstraints}
				className="w-full h-full object-contain"
				mirrored={true}
				onUserMediaError={() => {
					stopSharing();
					onStreamStop();
				}}
			/>
			<canvas
				ref={canvasRef}
				className="absolute inset-0 pointer-events-none"
			/>
		</div>
	);
}
