import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-transparent px-1 text-xs font-medium",
  {
    defaultVariants: {
      variant: "secondary",
    },
    variants: {
      variant: {
        outline: "border-input bg-background text-foreground dark:bg-input/32",
        secondary: "bg-secondary text-secondary-foreground",
      },
    },
  },
);

type BadgeProps = ComponentProps<"span"> & {
  variant?: VariantProps<typeof badgeVariants>["variant"];
};

export function Badge({
  className,
  variant,
  ...props
}: BadgeProps): ReactElement {
  return (
    <span
      className={cn(badgeVariants({ className, variant }))}
      data-slot="badge"
      {...props}
    />
  );
}
