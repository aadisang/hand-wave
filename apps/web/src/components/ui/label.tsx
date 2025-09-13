import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Styled wrapper around Radix UI's LabelPrimitive.Root.
 *
 * Applies a consistent set of utility classes (layout, typography, and disabled states),
 * sets `data-slot="label"`, and forwards all props to `LabelPrimitive.Root`.
 *
 * The `className` prop is merged with the component's default classes.
 */
function Label({
	className,
	...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
	return (
		<LabelPrimitive.Root
			data-slot="label"
			className={cn(
				"flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
