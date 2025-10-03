"use client";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePredictionStore } from "@/stores/prediction-store";
import { Loader2, Hand, Trash2, History } from "lucide-react";

/**
 * Displays real-time sign language detection results with prediction history.
 */
export function DetectionResults() {
	const currentPrediction = usePredictionStore((state) => state.currentPrediction);
	const history = usePredictionStore((state) => state.history);
	const isLoading = usePredictionStore((state) => state.isLoading);
	const isActive = usePredictionStore((state) => state.isActive);
	const clearHistory = usePredictionStore((state) => state.clearHistory);

	const formatTime = (date: Date) => {
		return new Date(date).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>Detection Results</CardTitle>
						<CardDescription>
							Real-time sign language detection
						</CardDescription>
					</div>
					{history.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							onClick={clearHistory}
							className="gap-2"
						>
							<Trash2 className="h-4 w-4" />
							Clear History
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Current Prediction Section */}
				{!isActive ? (
					<div className="text-center py-8 text-muted-foreground">
						<Hand className="h-12 w-12 mx-auto mb-3 opacity-50" />
						<p className="text-sm">Start the camera to begin detection</p>
					</div>
				) : currentPrediction ? (
					<div className="space-y-4">
						{/* Main Sign */}
						<div className="text-center space-y-2">
							<div className="text-6xl font-bold">
								{currentPrediction.text}
							</div>
							<div className="flex items-center justify-center gap-2">
								<Badge variant="secondary">
									{(currentPrediction.confidence * 100).toFixed(1)}%
								</Badge>
								<Badge variant="outline">
									{currentPrediction.processingTime.toFixed(0)}ms
								</Badge>
							</div>
						</div>

						{/* Alternative Predictions - Compact Grid */}
						{currentPrediction.topPredictions &&
							currentPrediction.topPredictions.length > 1 && (
								<div className="space-y-2">
									<div className="text-xs font-medium text-muted-foreground text-center">
										Other Possibilities
									</div>
									<div className="grid grid-cols-4 gap-1.5">
										{currentPrediction.topPredictions
											.slice(1, 5)
											.map((pred, idx) => (
												<div
													key={idx}
													className="flex flex-col items-center justify-center p-2 bg-muted/30 rounded-md"
												>
													<span className="text-lg font-semibold">
														{pred.label}
													</span>
													<Badge variant="outline" className="text-xs mt-1">
														{(pred.confidence * 100).toFixed(0)}%
													</Badge>
												</div>
											))}
									</div>
								</div>
							)}
					</div>
				) : isLoading ? (
					<div className="text-center py-8 text-muted-foreground">
						<Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin" />
						<p className="text-sm">Analyzing hand gesture...</p>
					</div>
				) : (
					<div className="text-center py-8 text-muted-foreground">
						<Hand className="h-12 w-12 mx-auto mb-3 opacity-50" />
						<p className="text-sm">Show an ASL sign to the camera</p>
						<p className="text-xs mt-2 opacity-70">
							A-Z alphabet + common phrases
						</p>
					</div>
				)}

				{/* History Table - Scrollable */}
				{history.length > 0 && (
					<div className="space-y-2 border-t pt-4">
						<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
							<History className="h-4 w-4" />
							Recent Detections ({history.length})
						</div>

						<div className="rounded-md border max-h-64 overflow-y-auto">
							<Table>
								<TableHeader className="sticky top-0 bg-background">
									<TableRow>
										<TableHead className="w-[120px]">Time</TableHead>
										<TableHead className="text-center w-[80px]">Sign</TableHead>
										<TableHead className="text-right w-[100px]">Confidence</TableHead>
										<TableHead className="text-right w-[80px]">Speed</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{history.map((item) => (
										<TableRow key={item.id}>
											<TableCell className="text-muted-foreground text-xs">
												{formatTime(item.timestamp)}
											</TableCell>
											<TableCell className="text-center">
												<span className="text-xl font-bold">
													{item.text}
												</span>
											</TableCell>
											<TableCell className="text-right">
												<Badge variant="secondary" className="text-xs">
													{(item.confidence * 100).toFixed(0)}%
												</Badge>
											</TableCell>
											<TableCell className="text-right">
												<Badge variant="outline" className="text-xs">
													{item.processingTime.toFixed(0)}ms
												</Badge>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
