import type { VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";
import { surfaceVariants } from "./surface-variants";

type SurfaceProps = ComponentProps<"div"> &
  VariantProps<typeof surfaceVariants>;

export function Surface({
  className,
  padding,
  radius,
  ...props
}: SurfaceProps): ReactElement {
  return (
    <div
      className={cn(surfaceVariants({ className, padding, radius }))}
      data-slot="surface"
      {...props}
    />
  );
}
