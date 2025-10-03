/**
 * WhatsApp service for sending messages via the WhatsApp Business API
 */

interface WhatsAppConfig {
	apiKey: string;
	phoneNumber: string;
}

interface SendMessageParams {
	message: string;
}

interface SendMessageResponse {
	success: boolean;
	messageId?: string;
	error?: string;
}

/**
 * Sends a message via WhatsApp API
 * @param params - The message parameters
 * @returns Response indicating success or failure
 */
export async function sendWhatsAppMessage(
	params: SendMessageParams,
): Promise<SendMessageResponse> {
	const apiKey = process.env.WHATSAPP_API_KEY;
	const phoneNumber = process.env.PHONE_NUMBER;

	if (!apiKey || !phoneNumber) {
		throw new Error(
			"WhatsApp API credentials not configured. Please set WHATSAPP_API_KEY and PHONE_NUMBER environment variables.",
		);
	}

	try {
		// WhatsApp Business API endpoint (using Cloud API)
		const response = await fetch(
			`https://graph.facebook.com/v21.0/${phoneNumber}/messages`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					messaging_product: "whatsapp",
					to: phoneNumber,
					type: "text",
					text: {
						body: params.message,
					},
				}),
			},
		);

		if (!response.ok) {
			const errorData = await response.json();
			return {
				success: false,
				error: errorData.error?.message || "Failed to send WhatsApp message",
			};
		}

		const data = await response.json();
		return {
			success: true,
			messageId: data.messages?.[0]?.id,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		};
	}
}
