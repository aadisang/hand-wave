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

							{/* Quick Actions */}
							{currentPrediction && (
								<div className="pt-4 border-t">
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
							)}
						</>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
