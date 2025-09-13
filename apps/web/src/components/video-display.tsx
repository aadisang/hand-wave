"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useHandLandmarker } from "@/hooks/useHandLandmarker";
import { useSharingStore } from "@/stores/sharing-store";
import { Monitor, MonitorOff, Video } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Camera } from "./camera";

export function VideoDisplay() {
	const { isSharing, streamType, stopSharing } = useSharingStore();
	const videoRef = useRef<HTMLVideoElement>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const hasStartedScreenShare = useRef(false);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { ready, start, stop } = useHandLandmarker();

	const getTitle = () => {
		if (streamType === "screen") return "Screen Share";
		if (streamType === "camera") return "Camera Feed";
		return "Preview";
	};

	const getDescription = () => {
		if (isSharing) {
			return "Your shared content will appear here for sign language detection";
		}
		return "Start sharing to see your content here";
	};

	const getIcon = () => {
		if (streamType === "screen") return <Monitor className="h-5 w-5" />;
		if (streamType === "camera") return <Video className="h-5 w-5" />;
		return <MonitorOff className="h-5 w-5" />;
	};

	const handleStreamStop = () => {
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
		}
		if (videoRef.current) {
			videoRef.current.srcObject = null;
		}
		stop();
		hasStartedScreenShare.current = false;
		stopSharing();
	};

	// Handle screen sharing when the component mounts and streamType is screen
	const startScreenShare = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				audio: false,
			});

			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				streamRef.current = stream;

				// Handle stream end
				stream.getVideoTracks()[0].onended = () => {
					handleStreamStop();
				};
			}
		} catch (error) {
			toast.error("Failed to start screen sharing");
			hasStartedScreenShare.current = false;
			stopSharing();
		}
	}, [stopSharing]);

	// Use useEffect to handle screen sharing initiation
	useEffect(() => {
		if (
			isSharing &&
			streamType === "screen" &&
			!hasStartedScreenShare.current
		) {
			hasStartedScreenShare.current = true;
			startScreenShare();
		}
	}, [isSharing, streamType, startScreenShare]);

	// Reset flag when not sharing
	useEffect(() => {
		if (!isSharing) {
			hasStartedScreenShare.current = false;
		}
	}, [isSharing]);

	// Start hand tracking on screen share
	useEffect(() => {
		if (!ready) return;
		if (!isSharing || streamType !== "screen") return;
		const video = videoRef.current;
		const canvas = canvasRef.current;
		if (!video || !canvas) return;

		const resize = () => {
			const parent = canvas.parentElement;
			if (!parent) return;
			const { clientWidth, clientHeight } = parent;
			canvas.style.width = `${clientWidth}px`;
			canvas.style.height = `${clientHeight}px`;
		};
		resize();
		const ro = new ResizeObserver(resize);
		if (canvas.parentElement) ro.observe(canvas.parentElement);

		start({ video, canvas, mirror: false });

		return () => {
			ro.disconnect();
			stop();
		};
	}, [ready, isSharing, streamType, start, stop]);

	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{getIcon()}
					{getTitle()}
				</CardTitle>
				<CardDescription>{getDescription()}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="relative aspect-video bg-neutral-100 dark:bg-neutral-800 rounded-lg overflow-hidden">
					{isSharing && streamType === "screen" ? (
						<div className="w-full h-full relative">
							<video
								ref={videoRef}
								autoPlay
								playsInline
								muted
								className="w-full h-full object-contain"
								style={{ width: "100%", height: "100%" }}
							/>
							<canvas
								ref={canvasRef}
								className="absolute inset-0 pointer-events-none"
							/>
						</div>
					) : isSharing && streamType === "camera" ? (
						<Camera onStreamStop={handleStreamStop} />
					) : (
						<div className="flex items-center justify-center h-full">
							<div className="text-center space-y-4">
								<MonitorOff className="h-16 w-16 mx-auto text-neutral-400" />
								<div className="space-y-2">
									<p className="text-neutral-600 dark:text-neutral-400 font-medium">
										No active stream
									</p>
									<p className="text-sm text-neutral-500 dark:text-neutral-500">
										Click "Share Screen" or "Start Camera" to begin
									</p>
								</div>
							</div>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
