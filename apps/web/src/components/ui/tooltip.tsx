"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cva } from "class-variance-authority";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export const Tooltip: typeof TooltipPrimitive.Root = TooltipPrimitive.Root;
export const TooltipProvider: typeof TooltipPrimitive.Provider =
  TooltipPrimitive.Provider;
export const TooltipTrigger: typeof TooltipPrimitive.Trigger =
  TooltipPrimitive.Trigger;
export const TooltipCreateHandle = TooltipPrimitive.createHandle;

const tooltipPopupVariants = cva(
  "max-w-64 origin-(--transform-origin) rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-lg/5 outline-none transition-[opacity,scale] duration-125 ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[instant]:transition-none motion-reduce:transition-none",
);

export function TooltipPopup({
  className,
  children,
  side = "top",
  sideOffset = 8,
  align = "center",
  alignOffset = 0,
  collisionPadding = 8,
  portalProps,
  ...props
}: TooltipPrimitive.Popup.Props & {
  portalProps?: TooltipPrimitive.Portal.Props;
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  align?: TooltipPrimitive.Positioner.Props["align"];
  alignOffset?: TooltipPrimitive.Positioner.Props["alignOffset"];
  collisionPadding?: TooltipPrimitive.Positioner.Props["collisionPadding"];
}): ReactElement {
  return (
    <TooltipPrimitive.Portal {...portalProps}>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-50"
        collisionPadding={collisionPadding}
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(tooltipPopupVariants(), className)}
          data-slot="tooltip-popup"
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
