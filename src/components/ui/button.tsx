"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Quiet chrome: a button carries weight through contrast and spacing, not
 * through gradients or shadows. Exactly one filled accent variant exists —
 * if two primary buttons appear on a screen, one of them is wrong.
 */
const buttonVariants = cva(
  "ui-transition inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] font-medium outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent-hover",
        secondary: "border border-line bg-surface text-text hover:bg-surface-3",
        ghost: "text-text-2 hover:bg-surface-3 hover:text-text",
        subtle: "bg-surface-3 text-text hover:brightness-110",
        danger: "bg-danger text-white hover:brightness-110",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-[var(--control-h-sm)] px-2 text-xs [&_svg]:size-3.5",
        md: "h-[var(--control-h)] px-3 text-sm [&_svg]:size-4",
        lg: "h-9 px-4 text-md [&_svg]:size-4",
        icon: "size-[var(--control-h)] [&_svg]:size-4",
        "icon-sm": "size-[var(--control-h-sm)] [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
