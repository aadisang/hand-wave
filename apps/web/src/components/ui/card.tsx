import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Stateless Card container component that renders a div with `data-slot="card"`.
 *
 * Merges default card styling classes with any provided `className` and forwards remaining div props to the container.
 *
 * @returns The rendered card `div` element.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Card header container for the Card layout.
 *
 * Renders a div with `data-slot="card-header"` and a set of layout/spacing classes suitable for card headers.
 * Any `className` passed in is merged with the component's default classes; remaining div props are spread onto the element.
 *
 * @returns A JSX element representing the card header container.
 */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Renders the card's title container.
 *
 * Renders a div with `data-slot="card-title"`, applies the default title typography classes
 * ("leading-none font-semibold") merged with any provided `className`, and forwards all other div props.
 *
 * @param className - Optional additional CSS class names merged with the default title classes.
 * @returns The rendered title div element.
 */
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn("leading-none font-semibold", className)}
			{...props}
		/>
	);
}

/**
 * Renders the card description slot.
 *
 * Merges the component's default description styles ("text-muted-foreground text-sm") with any
 * provided `className`, spreads remaining div props, and adds `data-slot="card-description"`.
 *
 * @returns A `div` element for the card description slot.
 */
function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

/**
 * Renders a container for card action controls (e.g., buttons) aligned to the card's top-right.
 *
 * Merges the provided `className` with the component's default grid and alignment classes and spreads any other div props onto the root element.
 *
 * @param className - Additional CSS classes to merge with the component defaults.
 * @returns A div with `data-slot="card-action"`.
 */
function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn(
				"col-start-2 row-span-2 row-start-1 self-start justify-self-end",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Main content container for a Card.
 *
 * Renders a <div> with `data-slot="card-content"` and a default horizontal padding (`px-6`).
 * Any provided `className` is merged with the default classes and all other props are forwarded to the div.
 *
 * @param className - Additional CSS classes to merge with the default padding.
 * @returns A React element representing the card content area.
 */
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn("px-6", className)}
			{...props}
		/>
	);
}

/**
 * Footer container for a Card.
 *
 * Renders a div with `data-slot="card-footer"` and default layout classes
 * ("flex items-center px-6 [.border-t]:pt-6"). Any `className` passed in is
 * merged with the defaults via `cn`, and all other div props are forwarded to
 * the rendered element.
 *
 * @param props - Standard div props; `className` will be merged with the component's default classes.
 * @returns The card footer element.
 */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-footer"
			className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
			{...props}
		/>
	);
}

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardAction,
	CardDescription,
	CardContent,
};
