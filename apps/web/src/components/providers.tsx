"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect } from "react";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

/**
 * Composes app-level providers (theme, React Query, toasts) around the application UI.
 *
 * Wraps `children` with a ThemeProvider (class-based theming, system default, transitions disabled),
 * a QueryClientProvider using the configured `queryClient` (includes ReactQueryDevtools), and renders
 * a global Toaster for notifications.
 *
 * @param children - The React element(s) to be wrapped by the provider tree (typically the app).
 * @returns The provider-wrapped React element tree.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
	// Suppress MediaPipe WASM info messages that appear as errors
	useEffect(() => {
		const originalError = console.error;
		console.error = (...args: unknown[]) => {
			const message = args[0];
			// Filter out TensorFlow Lite XNNPACK delegate info messages
			if (
				typeof message === "string" &&
				message.includes("Created TensorFlow Lite XNNPACK delegate")
			) {
				return; // Suppress this message
			}
			originalError.apply(console, args);
		};

		return () => {
			console.error = originalError;
		};
	}, []);
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			<trpc.Provider client={trpcClient} queryClient={queryClient}>
				<QueryClientProvider client={queryClient}>
					{children}
					<ReactQueryDevtools />
				</QueryClientProvider>
			</trpc.Provider>
			<Toaster richColors closeButton />
		</ThemeProvider>
	);
}
