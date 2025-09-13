import { cn } from "@/lib/utils";

/**
 * Simple skeleton UI block that renders a pulsing, rounded div.
 *
 * Merges the incoming `className` with default skeleton styles and forwards all other props to the underlying `div`.
 *
 * @param className - Optional additional CSS classes to apply (merged with the component's defaults).
 * @returns A `div` element styled as a skeleton placeholder.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn("bg-accent animate-pulse rounded-md", className)}
			{...props}
		/>
	);
}

export { Skeleton };
