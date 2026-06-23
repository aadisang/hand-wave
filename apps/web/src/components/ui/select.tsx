"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export const Select: typeof SelectPrimitive.Root = SelectPrimitive.Root;

const selectTriggerVariants = cva(
  "inline-flex w-full min-w-36 select-none items-center justify-between gap-1.5 rounded-lg border border-input bg-background text-left text-sm text-foreground shadow-xs/5 outline-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 data-disabled:pointer-events-none data-disabled:opacity-64 motion-reduce:transition-none dark:bg-input/32 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "sm",
    },
    variants: {
      size: {
        sm: "min-h-8 px-2.5",
      },
    },
  },
);

const selectPopupVariants = cva(
  "origin-(--transform-origin) text-foreground outline-none transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none",
);

const selectScrollArrowVariants = cva(
  "z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:h-[200%] before:from-50% before:from-popover",
  {
    variants: {
      direction: {
        down: "bottom-0 before:bottom-px before:rounded-b-[calc(var(--radius-lg)-1px)] before:bg-linear-to-t",
        up: "top-0 before:top-px before:rounded-t-[calc(var(--radius-lg)-1px)] before:bg-linear-to-b",
      },
    },
  },
);

const selectSurfaceVariants = cva(
  "relative h-full min-w-(--anchor-width) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
);

const selectListVariants = cva("max-h-(--available-height) overflow-y-auto", {
  defaultVariants: {
    density: "compact",
  },
  variants: {
    density: {
      compact: "p-0.5",
    },
  },
});

const selectItemVariants = cva(
  "grid in-data-[side=none]:min-w-[calc(var(--anchor-width)+0.75rem)] cursor-default grid-cols-[minmax(0,1fr)_1rem] items-center gap-2 rounded-sm outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "sm",
    },
    variants: {
      size: {
        sm: "min-h-8 py-1 ps-2.5 pe-1.5 text-base sm:min-h-7 sm:text-sm",
      },
    },
  },
);

type SelectTriggerProps = SelectPrimitive.Trigger.Props &
  VariantProps<typeof selectTriggerVariants>;

export function SelectTrigger({
  className,
  children,
  size,
  ...props
}: SelectTriggerProps): ReactElement {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ className, size }))}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronsUpDownIcon className="-me-1 opacity-80" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectValue({
  className,
  ...props
}: SelectPrimitive.Value.Props): ReactElement {
  return (
    <SelectPrimitive.Value
      className={cn(
        "flex-1 truncate data-placeholder:text-muted-foreground",
        className,
      )}
      data-slot="select-value"
      {...props}
    />
  );
}

export function SelectPopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  anchor,
  portalProps,
  ...props
}: SelectPrimitive.Popup.Props & {
  portalProps?: SelectPrimitive.Portal.Props;
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
}): ReactElement {
  return (
    <SelectPrimitive.Portal {...portalProps}>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 select-none"
        data-slot="select-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={selectPopupVariants()}
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className={selectScrollArrowVariants({ direction: "up" })}
            data-slot="select-scroll-up-arrow"
          >
            <ChevronUpIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitive.ScrollUpArrow>
          <div className={selectSurfaceVariants()}>
            <SelectPrimitive.List
              className={cn(selectListVariants(), className)}
              data-slot="select-list"
            >
              {children}
            </SelectPrimitive.List>
          </div>
          <SelectPrimitive.ScrollDownArrow
            className={selectScrollArrowVariants({ direction: "down" })}
            data-slot="select-scroll-down-arrow"
          >
            <ChevronDownIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props): ReactElement {
  return (
    <SelectPrimitive.Item
      className={cn(selectItemVariants(), className)}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText className="col-start-1 min-w-0">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="col-start-2 justify-self-end">
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
        </svg>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { SelectPopup as SelectContent };
