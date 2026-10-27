"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  width = "md",
  ...props
}: React.ComponentProps<typeof D.Content> & { width?: "sm" | "md" | "lg" | "xl" }) {
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
          "rounded-[var(--radius-panel)] border border-line bg-surface-2 shadow-[var(--shadow-overlay)]",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]",
          "duration-150 ease-out",
          widths[width],
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          aria-label="Хаах"
          className="ui-transition absolute right-3 top-3 rounded-[var(--radius-chip)] p-1 text-text-3 hover:bg-surface-3 hover:text-text"
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="border-b border-line px-5 py-4 pr-12">
      <D.Title className="text-md font-semibold tracking-tight text-text">{title}</D.Title>
      {description ? (
        <D.Description className="mt-1 text-sm text-text-3">{description}</D.Description>
      ) : (
        // Radix requires a description for a11y; an empty one is worse than none.
        <D.Description className="sr-only">{typeof title === "string" ? title : "Харилцах цонх"}</D.Description>
      )}
    </div>
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-h-[65vh] overflow-y-auto px-5 py-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 border-t border-line px-5 py-3", className)}
      {...props}
    />
  );
}
