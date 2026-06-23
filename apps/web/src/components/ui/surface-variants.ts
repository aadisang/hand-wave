import { cva } from "class-variance-authority";

export const surfaceVariants = cva(
  "border border-border bg-toolbar text-card-foreground backdrop-blur-[16px] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_18px_48px_rgba(0,0,0,0.24),0_2px_10px_rgba(0,0,0,0.18)]",
  {
    defaultVariants: {
      padding: "none",
      radius: "xl",
    },
    variants: {
      padding: {
        none: "",
        sm: "p-3",
        toolbar: "p-1",
      },
      radius: {
        xl: "rounded-xl",
      },
    },
  },
);
