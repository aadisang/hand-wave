import { publicProcedure, router } from "../lib/trpc";
import {
	PredictFromLandmarksInputSchema,
	PredictFromLandmarksOutputSchema,
	SendTranslationInputSchema,
	SendTranslationOutputSchema,
} from "../schema/translation";
import { predictFromLandmarks } from "../services/inference";
import { sendWhatsAppMessage } from "../services/whatsapp";

export const translationRouter = router({
	/**
	 * Predict ASL text from hand landmarks
	 */
	predictFromLandmarks: publicProcedure
		.input(PredictFromLandmarksInputSchema)
		.output(PredictFromLandmarksOutputSchema)
		.mutation(async ({ input }) => {
			const result = await predictFromLandmarks({ landmarks: input.landmarks });
			return {
				...result,
				timestamp: new Date().toISOString(),
			};
		}),

	/**
	 * Send translation via WhatsApp to Meta glasses
	 */
	send: publicProcedure
		.input(SendTranslationInputSchema)
		.output(SendTranslationOutputSchema)
		.mutation(async ({ input }) => {
			const result = await sendWhatsAppMessage({ message: input.translation });
			return {
				...result,
				timestamp: new Date().toISOString(),
			};
		}),
});
