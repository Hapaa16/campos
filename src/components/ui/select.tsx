"use client";

import * as React from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = S.Root;
export const SelectValue = S.Value;
export const SelectGroup = S.Group;

export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof S.Trigger>) {
  return (
    <S.Trigger
      className={cn(
        "ui-transition flex h-[var(--control-h)] items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-sm text-text outline-none",
        "hover:bg-surface-3 focus-visible:border-accent-line focus-visible:ring-2 focus-visible:ring-accent-soft data-[placeholder]:text-text-3",
        className,
      )}
      {...props}
    >
      {children}
      <S.Icon>
        <ChevronDown className="size-3.5 text-text-3" />
      </S.Icon>
    </S.Trigger>
  );
}

export function SelectContent({ className, children, ...props }: React.ComponentProps<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content
        position="popper"
        sideOffset={6}
        className={cn(
          "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface-2 shadow-[var(--shadow-overlay)]",
          className,
        )}
        {...props}
      >
        <S.Viewport className="p-1">{children}</S.Viewport>
      </S.Content>
    </S.Portal>
  );
}

export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof S.Item>) {
  return (
    <S.Item
      className={cn(
        "ui-transition relative flex cursor-default select-none items-center rounded-[var(--radius-chip)] py-1.5 pl-7 pr-2 text-sm text-text-2 outline-none",
        "data-[highlighted]:bg-surface-3 data-[highlighted]:text-text data-[state=checked]:text-text",
        className,
      )}
      {...props}
    >
      <S.ItemIndicator className="absolute left-2">
        <Check className="size-3.5 text-accent" />
      </S.ItemIndicator>
      <S.ItemText>{children}</S.ItemText>
    </S.Item>
  );
}

export function SelectLabel({ className, ...props }: React.ComponentProps<typeof S.Label>) {
  return (
    <S.Label
      className={cn("px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-text-3", className)}
      {...props}
    />
  );
}
