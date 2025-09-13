"use client";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

/**
 * Displays a presentational card for real-time sign language detection results.
 *
 * Renders a titled Card with a short description and a centered placeholder message.
 * This is a client-side, static UI component with no props or side effects.
 */
export function DetectionResults() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Detection Results</CardTitle>
				<CardDescription>
					Real-time sign language detection will appear here
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="text-center py-8 text-neutral-500 dark:text-neutral-400">
					<p>Detection results will appear here when signs are detected</p>
				</div>
			</CardContent>
		</Card>
	);
}
