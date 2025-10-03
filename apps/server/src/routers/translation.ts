import { publicProcedure, router } from "../lib/trpc";
import {
	SendTranslationInputSchema,
	SendTranslationOutputSchema,
} from "../schema/translation";
import { sendWhatsAppMessage } from "../services/whatsapp";

export const translationRouter = router({
	send: publicProcedure
		.input(SendTranslationInputSchema)
		.output(SendTranslationOutputSchema)
		.mutation(async ({ input }) => {
			const result = await sendWhatsAppMessage({
				message: input.translation,
			});

			return {
				success: result.success,
				messageId: result.messageId,
				error: result.error,
				timestamp: new Date().toISOString(),
			};
		}),
});
