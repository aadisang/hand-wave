import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";

type TableVariant = "default" | "card";

export function Table({
  className,
  variant = "default",
  ...props
}: ComponentProps<"table"> & { variant?: TableVariant }): ReactElement {
  return (
    <div
      className="relative w-full overflow-x-auto"
      data-slot="table-container"
      data-variant={variant}
    >
      <table
        className={cn(
          "w-full caption-bottom text-sm in-data-[variant=card]:border-separate in-data-[variant=card]:border-spacing-0",
          className,
        )}
        data-slot="table"
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: ComponentProps<"thead">): ReactElement {
  return (
    <thead
      className={cn("[&_tr]:border-b", className)}
      data-slot="table-header"
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: ComponentProps<"tbody">): ReactElement {
  return (
    <tbody
      className={cn(
        "relative [&_tr:last-child]:border-0 in-data-[variant=card]:rounded-xl in-data-[variant=card]:shadow-xs/5 before:pointer-events-none before:absolute before:inset-px before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] not-in-data-[variant=card]:before:hidden dark:before:shadow-[0_-1px_--theme(--color-white/8%)] in-data-[variant=card]:*:[tr]:border-0 in-data-[variant=card]:*:[tr]:*:[td]:border-b in-data-[variant=card]:*:[tr]:*:[td]:bg-card in-data-[variant=card]:*:[tr]:*:[td]:first:border-s in-data-[variant=card]:*:[tr]:*:[td]:last:border-e in-data-[variant=card]:*:[tr]:first:*:[td]:border-t in-data-[variant=card]:*:[tr]:first:*:[td]:first:rounded-ss-xl in-data-[variant=card]:*:[tr]:first:*:[td]:last:rounded-se-xl in-data-[variant=card]:*:[tr]:last:*:[td]:first:rounded-es-xl in-data-[variant=card]:*:[tr]:last:*:[td]:last:rounded-ee-xl in-data-[variant=card]:*:[tr]:hover:*:[td]:bg-[color-mix(in_srgb,var(--card),var(--color-black)_2%)] dark:in-data-[variant=card]:*:[tr]:hover:*:[td]:bg-[color-mix(in_srgb,var(--card),var(--color-white)_2%)]",
        className,
      )}
      data-slot="table-body"
      {...props}
    />
  );
}

export function TableFooter({
  className,
  ...props
}: ComponentProps<"tfoot">): ReactElement {
  return (
    <tfoot
      className={cn(
        "border-t bg-[color-mix(in_srgb,var(--card),var(--color-black)_2%)] font-medium dark:bg-[color-mix(in_srgb,var(--card),var(--color-white)_2%)] in-data-[variant=card]:border-none in-data-[variant=card]:bg-transparent dark:in-data-[variant=card]:bg-transparent [&>tr]:last:border-b-0",
        className,
      )}
      data-slot="table-footer"
      {...props}
    />
  );
}

export function TableRow({
  className,
  ...props
}: ComponentProps<"tr">): ReactElement {
  return (
    <tr
      className={cn(
        "relative border-b not-in-data-[variant=card]:hover:bg-[color-mix(in_srgb,var(--background),var(--color-black)_2%)] dark:not-in-data-[variant=card]:hover:bg-[color-mix(in_srgb,var(--background),var(--color-white)_2%)]",
        className,
      )}
      data-slot="table-row"
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: ComponentProps<"th">): ReactElement {
  return (
    <th
      className={cn(
        "h-10 whitespace-nowrap px-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wide leading-none has-[[role=checkbox]]:w-px last:has-[[role=checkbox]]:ps-0 first:has-[[role=checkbox]]:pe-0",
        className,
      )}
      data-slot="table-head"
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: ComponentProps<"td">): ReactElement {
  return (
    <td
      className={cn(
        "whitespace-nowrap bg-clip-padding px-3 py-3 align-middle leading-none in-data-[variant=card]:first:ps-[calc(--spacing(3)-1px)] in-data-[variant=card]:last:pe-[calc(--spacing(3)-1px)] has-[[role=checkbox]]:w-px last:has-[[role=checkbox]]:ps-0 first:has-[[role=checkbox]]:pe-0",
        className,
      )}
      data-slot="table-cell"
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ...props
}: ComponentProps<"caption">): ReactElement {
  return (
    <caption
      className={cn(
        "mt-4 text-muted-foreground text-sm in-data-[variant=card]:my-4",
        className,
      )}
      data-slot="table-caption"
      {...props}
    />
  );
}
