import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/components/providers";
import "../index.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Hand Wave",
	description:
		"Hand Wave is a real-time hand gesture translator for Meta AI glasses with a web UI.",
};

/**
 * Root layout component for the Hand Wave app.
 *
 * Renders the top-level HTML structure with lang set to "en", applies global font
 * CSS variables and antialiasing, and wraps the app content with shared providers.
 *
 * @param children - The React node(s) to render inside the app's main grid container.
 */
export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<Providers>
					<div className="grid grid-rows-[auto_1fr] h-svh">{children}</div>
				</Providers>
			</body>
		</html>
	);
}
