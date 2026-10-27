"use client";

import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

export function Tooltip({
  content,
  children,
  side = "bottom",
  shortcut,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  shortcut?: string;
}) {
  if (!content) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 flex items-center gap-2 rounded-[var(--radius-chip)] border border-line bg-surface-2 px-2 py-1 text-xs text-text",
            "shadow-[var(--shadow-overlay)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0",
          )}
        >
          {content}
          {shortcut && (
            <kbd className="rounded-[3px] border border-line bg-surface-inset px-1 font-mono text-2xs text-text-3">
              {shortcut}
            </kbd>
          )}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
