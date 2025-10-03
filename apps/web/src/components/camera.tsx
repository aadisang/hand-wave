"use client";
import { useEffect, useRef } from "react";
import Webcam from "react-webcam";
import { useASLPrediction } from "@/hooks/useASLPrediction";
import { useHolisticLandmarker } from "@/hooks/useHolisticLandmarker";
import { useSharingStore } from "@/stores/sharing-store";
import { usePredictionStore } from "@/stores/prediction-store";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface CameraProps {
	onStreamStop: () => void;
}

/**
 * Renders a webcam feed with a canvas overlay and starts holistic landmark processing.
 *
 * Uses MediaPipe HolisticLandmarker to detect face, pose, and hand landmarks needed
 * for ASL sign language recognition. Collected landmarks are sent to the ASL prediction hook.
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

	// Read from global store
	const currentPrediction = usePredictionStore((state) => state.currentPrediction);
	const isLoading = usePredictionStore((state) => state.isLoading);

	const videoConstraints = {
		width: 1280,
		height: 720,
		facingMode: "user",
	};

	useEffect(() => {
		const videoEl = webcamRef.current?.video as HTMLVideoElement | undefined;
		const canvasEl = canvasRef.current ?? undefined;
		if (!ready || !videoEl || !canvasEl) return;

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
	}, [ready, start, stop, addLandmarkFrame]);

	// Separate effect for starting prediction (only once when ready)
	useEffect(() => {
		if (ready) {
			startPrediction();
		}
		// Intentionally omitting startPrediction from deps to only call once when ready changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ready]);

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

			{/* Live Prediction Overlay */}
			{currentPrediction && (
				<div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
					<Card className="bg-background/95 backdrop-blur-sm border-2 shadow-lg">
						<div className="px-6 py-4 space-y-2">
							<div className="flex items-center justify-center gap-3">
								<span className="text-sm font-medium text-muted-foreground">
									Detected Sign:
								</span>
								<div className="text-4xl font-bold tracking-tight">
									{currentPrediction.text}
								</div>
							</div>
							<div className="flex items-center justify-center gap-2">
								<Badge variant="secondary" className="text-xs">
									{(currentPrediction.confidence * 100).toFixed(0)}% confident
								</Badge>
								<Badge variant="outline" className="text-xs">
									{currentPrediction.processingTime.toFixed(0)}ms
								</Badge>
							</div>
						</div>
					</Card>
				</div>
			)}

			{/* Loading Indicator */}
			{isLoading && !currentPrediction && (
				<div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
					<Badge variant="secondary" className="animate-pulse">
						Analyzing hand gesture...
					</Badge>
				</div>
			)}
		</div>
	);
}
