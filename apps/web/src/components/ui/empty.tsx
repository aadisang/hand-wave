import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";

const mediaClassName =
  "relative flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-foreground shadow-sm/5 [&_svg]:size-4.5 [&_svg]:shrink-0";

export function Empty({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 text-balance px-6 py-12 text-center md:py-20",
        className,
      )}
      data-slot="empty"
      {...props}
    />
  );
}

export function EmptyHeader({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn(
        "flex max-w-sm flex-col items-center text-center",
        className,
      )}
      data-slot="empty-header"
      {...props}
    />
  );
}

export function EmptyMedia({
  children,
  className,
  variant: _variant,
  ...props
}: ComponentProps<"div"> & { variant?: "icon" }): ReactElement {
  return (
    <div
      className={cn("relative mb-6", className)}
      data-slot="empty-media"
      data-variant="icon"
      {...props}
    >
      <div
        aria-hidden="true"
        className={cn(
          mediaClassName,
          "pointer-events-none absolute bottom-px origin-bottom-left -translate-x-0.5 -rotate-10 scale-84 shadow-none",
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          mediaClassName,
          "pointer-events-none absolute bottom-px origin-bottom-right translate-x-0.5 rotate-10 scale-84 shadow-none",
        )}
      />
      <div className={mediaClassName}>{children}</div>
    </div>
  );
}

export function EmptyTitle({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return (
    <div
      className={cn("font-heading font-semibold text-xl", className)}
      data-slot="empty-title"
      {...props}
    />
  );
}

export function EmptyDescription({
  className,
  ...props
}: ComponentProps<"p">): ReactElement {
  return (
    <p
      className={cn(
        "text-muted-foreground text-sm [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4 [[data-slot=empty-title]+&]:mt-1",
        className,
      )}
      data-slot="empty-description"
      {...props}
    />
  );
}
