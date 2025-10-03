import { z } from "zod";

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

export type SendTranslationInput = z.infer<typeof SendTranslationInputSchema>;
export type SendTranslationOutput = z.infer<typeof SendTranslationOutputSchema>;
