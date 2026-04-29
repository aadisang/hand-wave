import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "sm",
      variant: "default",
    },
    variants: {
      size: {
        sm: "h-8 px-2.5 text-sm sm:h-7",
        "icon-sm": "size-8 sm:size-7",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs hover:bg-primary/90",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground shadow-destructive/24 shadow-xs hover:bg-destructive/90",
        ghost: "border-transparent text-foreground hover:bg-accent",
        outline:
          "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90",
      },
    },
  },
);

type ButtonProps = ComponentProps<"button"> & {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
};

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonProps): ReactElement {
  return (
    <button
      className={cn(buttonVariants({ className, size, variant }))}
      data-slot="button"
      type="button"
      {...props}
    />
  );
}
