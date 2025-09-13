import { Loader2 } from "lucide-react";

/**
 * Full-height centered spinner using lucide-react's Loader2.
 *
 * Renders a full-height flex container that centers a spinning Loader2 icon with top padding.
 *
 * @returns The JSX element for the centered, animated loader.
 */
export default function Loader() {
	return (
		<div className="flex h-full items-center justify-center pt-8">
			<Loader2 className="animate-spin" />
		</div>
	);
}
