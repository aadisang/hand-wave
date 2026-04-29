"use client";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export function Toolbar({
  className,
  ...props
}: ToolbarPrimitive.Root.Props): ReactElement {
  return (
    <ToolbarPrimitive.Root
      className={cn(
        "relative flex gap-2 rounded-xl border bg-card not-dark:bg-clip-padding p-1 text-card-foreground",
        className,
      )}
      data-slot="toolbar"
      {...props}
    />
  );
}

export function ToolbarGroup({
  className,
  ...props
}: ToolbarPrimitive.Group.Props): ReactElement {
  return (
    <ToolbarPrimitive.Group
      className={cn("flex items-center gap-1", className)}
      data-slot="toolbar-group"
      {...props}
    />
  );
}

export function ToolbarSeparator({
  className,
  ...props
}: ToolbarPrimitive.Separator.Props): ReactElement {
  return (
    <ToolbarPrimitive.Separator
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:my-0.5 data-[orientation=vertical]:my-1.5 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:not-[[class^='h-']]:not-[[class*='_h-']]:self-stretch",
        className,
      )}
      data-slot="toolbar-separator"
      {...props}
    />
  );
}
