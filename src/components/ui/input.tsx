"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "ui-transition h-[var(--control-h)] w-full rounded-[var(--radius-control)] border border-line bg-surface-inset px-2.5 text-sm text-text outline-none",
        "placeholder:text-text-3 hover:border-line-strong focus-visible:border-accent-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "ui-transition min-h-20 w-full rounded-[var(--radius-control)] border border-line bg-surface-inset px-2.5 py-2 text-sm text-text outline-none",
        "placeholder:text-text-3 hover:border-line-strong focus-visible:border-accent-line focus-visible:ring-2 focus-visible:ring-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium text-text-2", className)}
      {...props}
    />
  );
}
