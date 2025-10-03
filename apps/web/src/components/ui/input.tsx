import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Styled wrapper around a native `<input>` that applies project-standard UI classes.
 *
 * Renders a fully‑typed input element with a comprehensive set of base utility classes
 * (colors, sizing, focus/aria-invalid states, dark-mode variants, file input styling, etc.)
 * and merges any `className` passed via props.
 *
 * @param className - Optional extra CSS classes to merge with the component's base classes.
 * @param type - Input `type` attribute forwarded to the underlying `<input>`.
 * @returns A JSX element representing the styled `<input>`.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
				"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
				"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
