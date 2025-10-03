"use client";
import {
	Circle,
	MessageCircle,
	Send,
	Settings,
	Share2,
	Square,
	Video,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useASLPrediction } from "@/hooks/useASLPrediction";
import { useSharingStore } from "@/stores/sharing-store";
import { trpc } from "@/utils/trpc";

/**
 * Renders a control panel for managing sharing and camera sessions.
 *
 * Displays current sharing status, an optional stream type badge (screen or camera),
 * and action buttons that toggle between "Share Screen" / "Start Camera" when idle
 * and "Stop Sharing" when active. Button handlers invoke the corresponding store actions:
 * `startScreenShare`, `startCamera`, and `stopSharing`.
 *
 * @returns The React element for the control panel.
 */
export function ControlPanel() {
	const { isSharing, streamType, startScreenShare, startCamera, stopSharing } =
		useSharingStore();
	const { predictionResult, isLoading, frameCount } = useASLPrediction();

	const sendWhatsAppMutation = trpc.translation.send.useMutation({
		onSuccess: () => {
			toast.success("Sent to WhatsApp!");
		},
		onError: (error) => {
			toast.error(`Failed to send: ${error.message}`);
		},
	});

	const handleSendToWhatsApp = () => {
		if (predictionResult?.text) {
			sendWhatsAppMutation.mutate({ translation: predictionResult.text });
		}
	};

	return (
		<Card className="lg:col-span-1">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Settings className="h-5 w-5" />
					Controls
				</CardTitle>
				<CardDescription>
					Manage your sharing session and settings
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Status */}
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Status</span>
					<Badge variant={isSharing ? "default" : "secondary"}>
						{isSharing ? "Sharing" : "Idle"}
					</Badge>
				</div>

				{/* Stream Type */}
				{streamType && (
					<div className="flex items-center justify-between">
						<span className="text-sm font-medium">Stream Type</span>
						<Badge variant="outline">
							{streamType === "screen" ? "Screen Share" : "Camera"}
						</Badge>
					</div>
				)}

				{/* Action Buttons */}
				<div className="space-y-3 pt-4">
					{!isSharing ? (
						<>
							<Button onClick={startScreenShare} className="w-full" size="lg">
								<Share2 className="h-5 w-5 mr-2" />
								Share Screen
							</Button>
							<Button
								onClick={startCamera}
								variant="outline"
								className="w-full"
								size="lg"
							>
								<Video className="h-5 w-5 mr-2" />
								Start Camera
							</Button>
						</>
					) : (
						<>
							<Button
								onClick={stopSharing}
								variant="destructive"
								className="w-full"
								size="lg"
							>
								<Square className="h-5 w-5 mr-2" />
								Stop Sharing
							</Button>

							{/* ASL Prediction Status */}
							<div className="pt-4 border-t space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">ASL Recognition</span>
									<Badge variant="default">
										{isLoading
											? "Processing..."
											: `Active (${frameCount} frames)`}
									</Badge>
								</div>

								{/* Live Prediction Result */}
								{predictionResult ? (
									<div className="space-y-2">
										<div className="text-sm font-medium">
											Latest Prediction:
										</div>
										<div className="p-3 bg-muted rounded-md">
											<div className="text-lg font-bold">
												{predictionResult.text || "No prediction"}
											</div>
											<div className="text-xs text-muted-foreground mt-1">
												Confidence:{" "}
												{(predictionResult.confidence * 100).toFixed(1)}% •{" "}
												{predictionResult.processingTime.toFixed(0)}ms
											</div>
										</div>
										<Button
											onClick={handleSendToWhatsApp}
											className="w-full"
											variant="secondary"
											disabled={sendWhatsAppMutation.isPending}
										>
											<MessageCircle className="h-4 w-4 mr-2" />
											{sendWhatsAppMutation.isPending
												? "Sending..."
												: "Send to WhatsApp"}
										</Button>
									</div>
								) : (
									<div className="text-sm text-muted-foreground text-center py-4">
										Collecting frames... predictions will appear automatically
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
