import { publicProcedure, router } from "../lib/trpc";
import {
	DetectionInputSchema,
	DetectionOutputSchema,
} from "../schema/detection";

export const detectionRouter = router({
	detect: publicProcedure
		.input(DetectionInputSchema)
		.output(DetectionOutputSchema)
		.mutation(async () => {
			// TODO: Implement actual detection logic, for now we'll simulate a delay and return a random sign
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Random letter A-Z
			const randomSign = String.fromCharCode(
				65 + Math.floor(Math.random() * 26),
			);

			// Random confidence between 0.6 and 1.0
			const confidence = Math.random() * 0.4 + 0.6;

			return {
				detectedSign: randomSign,
				confidence,
				boundingBox: {
					x: Math.random() * 100,
					y: Math.random() * 100,
					width: 50 + Math.random() * 100,
					height: 50 + Math.random() * 100,
				},
				processingTime: 500 + Math.floor(Math.random() * 200),
				modelVersion: "1.0.0",
				timestamp: new Date().toISOString(),
			};
		}),
});
