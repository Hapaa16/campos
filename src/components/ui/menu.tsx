"use client";

import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuGroup = M.Group;

const panelClass =
  "z-50 min-w-44 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface-2 p-1 shadow-[var(--shadow-overlay)] " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] duration-120";

const itemClass =
  "ui-transition flex cursor-default select-none items-center gap-2 rounded-[var(--radius-chip)] px-2 py-1.5 text-sm text-text-2 outline-none " +
  "data-[highlighted]:bg-surface-3 data-[highlighted]:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0";

export function MenuContent({ className, ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={6} align="end" className={cn(panelClass, className)} {...props} />
    </M.Portal>
  );
}

export function MenuItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return <M.Item className={cn(itemClass, className)} {...props} />;
}

export function MenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem className={cn(itemClass, "pl-7", className)} {...props}>
      <M.ItemIndicator className="absolute left-2">
        <Check className="size-3.5 text-accent" />
      </M.ItemIndicator>
      {children}
    </M.CheckboxItem>
  );
}

export function MenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(itemClass, "relative pl-7", className)} {...props}>
      <M.ItemIndicator className="absolute left-2">
        <Check className="size-3.5 text-accent" />
      </M.ItemIndicator>
      {children}
    </M.RadioItem>
  );
}

export const MenuRadioGroup = M.RadioGroup;

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return (
    <M.Label
      className={cn("px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-text-3", className)}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />;
}
