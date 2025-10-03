import { z } from "zod";

/**
 * Schema for landmark frame (single frame of hand landmarks)
 */
export const LandmarkFrameSchema = z.array(z.array(z.number()));

/**
 * Schema for predicting ASL from landmarks
 */
export const PredictFromLandmarksInputSchema = z.object({
	landmarks: z.array(LandmarkFrameSchema),
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
