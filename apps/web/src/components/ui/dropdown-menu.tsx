"use client";

import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Wrapper around Radix's DropdownMenu Root that adds a `data-slot="dropdown-menu"` attribute.
 *
 * Forwards all props to `DropdownMenuPrimitive.Root`, preserving its behavior while ensuring a consistent
 * data-slot hook for styling and testing.
 */
function DropdownMenu({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
	return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

/**
 * Wrapper around Radix UI's DropdownMenu Portal that adds a `data-slot` attribute.
 *
 * Renders `DropdownMenuPrimitive.Portal` with `data-slot="dropdown-menu-portal"` and forwards all props.
 *
 * @returns The Portal element used to render dropdown menu content.
 */
function DropdownMenuPortal({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
	return (
		<DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
	);
}

/**
 * Wrapper around Radix's DropdownMenu Trigger that forwards all props and sets a consistent `data-slot`.
 *
 * Renders a DropdownMenuPrimitive.Trigger with `data-slot="dropdown-menu-trigger"` so the trigger can be
 * consistently targeted by styling, tests, or analytics. All standard Trigger props are forwarded.
 */
function DropdownMenuTrigger({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
	return (
		<DropdownMenuPrimitive.Trigger
			data-slot="dropdown-menu-trigger"
			{...props}
		/>
	);
}

/**
 * Renders the dropdown menu content within a Portal and applies consistent styling and data attributes.
 *
 * The component forwards all other DropdownMenuPrimitive.Content props to the underlying Radix primitive.
 *
 * @param className - Additional CSS classes merged with the component's default styling.
 * @param sideOffset - Distance in pixels between the trigger and the content (defaults to 4).
 * @returns The rendered dropdown content element.
 */
function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				data-slot="dropdown-menu-content"
				sideOffset={sideOffset}
				className={cn(
					"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

/**
 * Wrapper around Radix DropdownMenu Group that adds a `data-slot` attribute and forwards all props.
 *
 * Renders `DropdownMenuPrimitive.Group` with `data-slot="dropdown-menu-group"` and passes through any received props.
 */
function DropdownMenuGroup({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
	return (
		<DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
	);
}

/**
 * Dropdown menu item component that wraps Radix's DropdownMenu.Item with project styles.
 *
 * Renders a DropdownMenu item with data-slot="dropdown-menu-item", forwards all underlying
 * Item props, and sets `data-inset` and `data-variant` attributes which control spacing and visual variant.
 *
 * @param inset - If true, applies inset padding to align content with left-side indicators/icons.
 * @param variant - Visual variant for the item; `"destructive"` applies destructive styling, `"default"` is neutral.
 */
function DropdownMenuItem({
	className,
	inset,
	variant = "default",
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
	inset?: boolean;
	variant?: "default" | "destructive";
}) {
	return (
		<DropdownMenuPrimitive.Item
			data-slot="dropdown-menu-item"
			data-inset={inset}
			data-variant={variant}
			className={cn(
				"focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Checkbox-enabled dropdown menu item that displays a left-aligned check indicator.
 *
 * Renders a Radix CheckboxItem with consistent styling and a built-in ItemIndicator containing a CheckIcon.
 * Forwards all CheckboxItem props to the underlying primitive and includes a `data-slot="dropdown-menu-checkbox-item"`
 * attribute for instrumentation.
 *
 * @param checked - If provided, controls the checked state (controlled component).
 */
function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			data-slot="dropdown-menu-checkbox-item"
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			checked={checked}
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<CheckIcon className="size-4" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

/**
 * Wrapper around Radix's DropdownMenu RadioGroup that injects a `data-slot` attribute.
 *
 * Renders `DropdownMenuPrimitive.RadioGroup` with `data-slot="dropdown-menu-radio-group"`
 * and forwards all received props to the underlying Radix primitive.
 */
function DropdownMenuRadioGroup({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
	return (
		<DropdownMenuPrimitive.RadioGroup
			data-slot="dropdown-menu-radio-group"
			{...props}
		/>
	);
}

/**
 * A styled wrapper around Radix UI's RadioItem that adds a left-aligned radio indicator and a data-slot attribute.
 *
 * Renders a RadioItem with consistent styling, an ItemIndicator containing a circle icon on the left, and forwards all RadioItem props.
 */
function DropdownMenuRadioItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
	return (
		<DropdownMenuPrimitive.RadioItem
			data-slot="dropdown-menu-radio-item"
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<CircleIcon className="size-2 fill-current" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.RadioItem>
	);
}

/**
 * Label element for dropdown menu sections.
 *
 * Wraps Radix `DropdownMenuPrimitive.Label`, adding a `data-slot` attribute and the component's
 * standard styling. When `inset` is true the label receives additional left padding to align
 * with items that include a leading indicator or icon.
 *
 * @param inset - If true, apply left inset padding for alignment with indented items.
 */
function DropdownMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
	inset?: boolean;
}) {
	return (
		<DropdownMenuPrimitive.Label
			data-slot="dropdown-menu-label"
			data-inset={inset}
			className={cn(
				"px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Renders a styled dropdown menu separator.
 *
 * Adds a `data-slot="dropdown-menu-separator"` attribute and applies default separator
 * styling; any `className` passed is merged with the defaults.
 *
 * @param className - Additional classes to merge with the component's default styles.
 * @returns A `DropdownMenuPrimitive.Separator` element with merged classes and data-slot attribute.
 */
function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("bg-border -mx-1 my-1 h-px", className)}
			{...props}
		/>
	);
}

/**
 * Renders an inline shortcut element aligned to the right inside a dropdown menu.
 *
 * Accepts all native <span> props and merges a provided `className` with the component's
 * default styles. Adds `data-slot="dropdown-menu-shortcut"` for integration with slot-based tooling.
 *
 * @param className - Additional CSS classes to apply to the shortcut element.
 */
function DropdownMenuShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="dropdown-menu-shortcut"
			className={cn(
				"text-muted-foreground ml-auto text-xs tracking-widest",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Wrapper around Radix UI's DropdownMenu.Sub that adds a `data-slot` attribute.
 *
 * Forwards all props to `DropdownMenuPrimitive.Sub` and sets `data-slot="dropdown-menu-sub"`.
 */
function DropdownMenuSub({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
	return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

/**
 * Submenu trigger used inside a DropdownMenu that displays a right-aligned chevron.
 *
 * Renders a Radix `SubTrigger` with consistent styling, a `data-slot="dropdown-menu-sub-trigger"` attribute,
 * and a right-side `ChevronRightIcon`. Accepts all props supported by `DropdownMenuPrimitive.SubTrigger`.
 *
 * @param inset - If true, applies an inset style (adds left padding and sets `data-inset`).
 */
function DropdownMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
	inset?: boolean;
}) {
	return (
		<DropdownMenuPrimitive.SubTrigger
			data-slot="dropdown-menu-sub-trigger"
			data-inset={inset}
			className={cn(
				"focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronRightIcon className="ml-auto size-4" />
		</DropdownMenuPrimitive.SubTrigger>
	);
}

/**
 * Submenu content wrapper that applies consistent styling and data attributes.
 *
 * Renders a Radix `DropdownMenuPrimitive.SubContent` with a `data-slot="dropdown-menu-sub-content"` attribute, a set of default styling and animation classes, and forwards all other props to the underlying primitive.
 *
 * @param className - Extra CSS classes to merge with the component's default classes.
 */
function DropdownMenuSubContent({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
	return (
		<DropdownMenuPrimitive.SubContent
			data-slot="dropdown-menu-sub-content"
			className={cn(
				"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
				className,
			)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuPortal,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
};
