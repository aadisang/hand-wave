import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";

export function CardFrame({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs/5",
        className,
      )}
      data-slot="card-frame"
      {...props}
    />
  );
}

export function CardFrameHeader({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn(
        "grid auto-rows-min grid-rows-[auto_auto] items-start gap-x-4 px-6 py-4 has-data-[slot=card-frame-action]:grid-cols-[1fr_auto]",
        className,
      )}
      data-slot="card-frame-header"
      {...props}
    />
  );
}

export function CardFrameTitle({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn("self-center font-semibold text-sm", className)}
      data-slot="card-frame-title"
      {...props}
    />
  );
}

export function CardFrameDescription({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn("self-center text-muted-foreground text-sm", className)}
      data-slot="card-frame-description"
      {...props}
    />
  );
}

export function CardFrameAction({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn(
        "col-start-2 row-span-2 row-start-1 inline-flex self-center justify-self-end",
        className,
      )}
      data-slot="card-frame-action"
      {...props}
    />
  );
}
