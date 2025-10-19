import { z } from "zod";

/**
 * Schema for hand landmark point [x, y]
 */
export const LandmarkPointSchema = z.array(z.number()).length(2);

/**
 * Schema for single hand (21 landmarks, each with [x, y])
 */
export const HandLandmarksSchema = z.array(LandmarkPointSchema).length(21);

/**
 * Schema for predicting ASL from landmarks
 * Expects hand landmarks: [21, 2] for static signs
 */
export const PredictFromLandmarksInputSchema = z.object({
	landmarks: HandLandmarksSchema,
	imageWidth: z.number().optional().default(1920),
	imageHeight: z.number().optional().default(1080),
	mode: z.enum(["static", "movement"]).optional().default("static"),
});

export const PredictFromLandmarksOutputSchema = z.object({
	success: z.boolean(),
	text: z.string().optional(),
	confidence: z.number().optional(),
	processingTime: z.number().optional(),
	topPredictions: z
		.array(
			z.object({
				label: z.string(),
				confidence: z.number(),
			}),
		)
		.optional(),
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

export type LandmarkPoint = z.infer<typeof LandmarkPointSchema>;
export type HandLandmarks = z.infer<typeof HandLandmarksSchema>;
export type PredictFromLandmarksInput = z.infer<
	typeof PredictFromLandmarksInputSchema
>;
export type PredictFromLandmarksOutput = z.infer<
	typeof PredictFromLandmarksOutputSchema
>;
export type SendTranslationInput = z.infer<typeof SendTranslationInputSchema>;
export type SendTranslationOutput = z.infer<typeof SendTranslationOutputSchema>;
