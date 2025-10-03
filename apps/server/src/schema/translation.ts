import { z } from "zod";

/**
 * Schema for landmark frame (single frame of hand landmarks)
 * Each frame is a flat array of 390 features
 */
export const LandmarkFrameSchema = z.array(z.number()).length(390);

/**
 * Schema for predicting ASL from landmarks
 * Expects an array of frames: [num_frames, 390]
 */
export const PredictFromLandmarksInputSchema = z.object({
	landmarks: z.array(LandmarkFrameSchema).min(1),
});

export const PredictFromLandmarksOutputSchema = z.object({
	success: z.boolean(),
	text: z.string().optional(),
	confidence: z.number().optional(),
	processingTime: z.number().optional(),
	error: z.string().optional(),
	timestamp: z.string(),
});

/**
 * Schema for sending translation via WhatsApp
 */
export const SendTranslationInputSchema = z.object({
	translation: z.string().min(1, "Translation text cannot be empty"),
});

export const SendTranslationOutputSchema = z.object({
	success: z.boolean(),
	messageId: z.string().optional(),
	error: z.string().optional(),
	timestamp: z.string(),
});

export type LandmarkFrame = z.infer<typeof LandmarkFrameSchema>;
export type PredictFromLandmarksInput = z.infer<
	typeof PredictFromLandmarksInputSchema
>;
export type PredictFromLandmarksOutput = z.infer<
	typeof PredictFromLandmarksOutputSchema
>;
export type SendTranslationInput = z.infer<typeof SendTranslationInputSchema>;
export type SendTranslationOutput = z.infer<typeof SendTranslationOutputSchema>;
