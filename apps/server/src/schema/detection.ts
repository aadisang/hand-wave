import { z } from "zod";

export const DetectionInputSchema = z
	.object({
		imageData: z.string().optional(), // Base64 encoded image data
		videoData: z.string().optional(), // Base64 encoded video data
		audioData: z.string().optional(), // Base64 encoded audio data
	})
	.refine((data) => data.imageData || data.videoData || data.audioData, {
		message: "At least one of imageData, videoData, or audioData is required",
	});

export const DetectionOutputSchema = z.object({
	detectedSign: z.string(),
	confidence: z.number().min(0).max(1),
	boundingBox: z
		.object({
			x: z.number(),
			y: z.number(),
			width: z.number(),
			height: z.number(),
		})
		.optional(),
	processingTime: z.number(), // in milliseconds
	modelVersion: z.string(),
	timestamp: z.string(),
});
