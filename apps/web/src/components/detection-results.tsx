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
import { Hand, Trash2, History } from "lucide-react";

/**
 * Displays prediction history in a clean table format.
 * Does NOT show current prediction (that's on the camera overlay).
 */
export function DetectionResults() {
	const history = usePredictionStore((state) => state.history);
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
						<CardTitle className="flex items-center gap-2">
							<History className="h-5 w-5" />
							Detection History
						</CardTitle>
						<CardDescription>
							Recent sign language detections ({history.length}/20)
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
							Clear
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{!isActive ? (
					<div className="text-center py-12 text-muted-foreground">
						<Hand className="h-12 w-12 mx-auto mb-3 opacity-50" />
						<p className="text-sm">Start the camera to begin detection</p>
						<p className="text-xs mt-2 opacity-70">
							Detected signs will appear here
						</p>
					</div>
				) : history.length === 0 ? (
					<div className="text-center py-12 text-muted-foreground">
						<History className="h-12 w-12 mx-auto mb-3 opacity-50" />
						<p className="text-sm">No detections yet</p>
						<p className="text-xs mt-2 opacity-70">
							Show an ASL sign to the camera
						</p>
					</div>
				) : (
					<div className="rounded-md border h-[400px] overflow-hidden flex flex-col">
						<div className="flex-1 overflow-y-auto">
							<Table>
								<TableHeader className="sticky top-0 bg-background z-10">
									<TableRow>
										<TableHead className="w-[140px]">Time</TableHead>
										<TableHead className="text-center w-[100px]">Sign</TableHead>
										<TableHead className="text-right w-[120px]">Confidence</TableHead>
										<TableHead className="text-right w-[100px]">Speed</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{history.map((item) => (
										<TableRow key={item.id}>
											<TableCell className="text-muted-foreground text-sm">
												{formatTime(item.timestamp)}
											</TableCell>
											<TableCell className="text-center">
												<span className="text-2xl font-bold">
													{item.text}
												</span>
											</TableCell>
											<TableCell className="text-right">
												<Badge variant="secondary" className="text-xs">
													{(item.confidence * 100).toFixed(1)}%
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
