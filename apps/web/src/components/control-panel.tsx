"use client";
import {
	Circle,
	MessageCircle,
	Square,
	Video,
	Share2,
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
import { useSharingStore } from "@/stores/sharing-store";
import { usePredictionStore } from "@/stores/prediction-store";
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

	// Read from global prediction store
	const currentPrediction = usePredictionStore((state) => state.currentPrediction);
	const isLoading = usePredictionStore((state) => state.isLoading);
	const isActive = usePredictionStore((state) => state.isActive);

	const sendWhatsAppMutation = trpc.translation.send.useMutation({
		onSuccess: () => {
			toast.success("Sent to WhatsApp!");
		},
		onError: (error) => {
			toast.error(`Failed to send: ${error.message}`);
		},
	});

	const handleSendToWhatsApp = () => {
		if (currentPrediction?.text) {
			sendWhatsAppMutation.mutate({ translation: currentPrediction.text });
		}
	};

	return (
		<Card className="lg:col-span-1">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Circle className="h-5 w-5" />
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
									<Badge variant={isLoading ? "secondary" : isActive ? "default" : "outline"}>
										{isLoading ? "Analyzing..." : isActive ? "Real-time" : "Idle"}
									</Badge>
								</div>

								{/* Live Prediction Result */}
								{currentPrediction ? (
									<div className="space-y-3">
										{/* Main Prediction */}
										<div className="space-y-2">
											<div className="text-sm font-medium text-muted-foreground">
												Detected Sign
											</div>
											<div className="p-4 bg-primary/10 border-2 border-primary/20 rounded-lg">
												<div className="text-3xl font-bold text-center mb-2">
													{currentPrediction.text}
												</div>
												<div className="flex items-center justify-center gap-2">
													<Badge variant="secondary" className="text-xs">
														{(currentPrediction.confidence * 100).toFixed(0)}%
													</Badge>
													<Badge variant="outline" className="text-xs">
														{currentPrediction.processingTime.toFixed(0)}ms
													</Badge>
												</div>
											</div>
										</div>

										{/* Top Predictions */}
										{currentPrediction.topPredictions &&
											currentPrediction.topPredictions.length > 1 && (
												<div className="space-y-2">
													<div className="text-sm font-medium text-muted-foreground">
														Other Possibilities
													</div>
													<div className="space-y-1.5">
														{currentPrediction.topPredictions
															.slice(1, 4)
															.map((pred, idx) => (
																<div
																	key={idx}
																	className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-sm"
																>
																	<span className="font-medium">
																		{pred.label}
																	</span>
																	<Badge variant="outline" className="text-xs">
																		{(pred.confidence * 100).toFixed(0)}%
																	</Badge>
																</div>
															))}
													</div>
												</div>
											)}

										{/* Send Button */}
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
									<div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
										<Circle className="h-8 w-8 text-muted-foreground/50 animate-pulse" />
										<div className="text-sm text-muted-foreground">
											Show an ASL sign to the camera
										</div>
										<div className="text-xs text-muted-foreground/70">
											Supports A-Z alphabet + common phrases
										</div>
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
