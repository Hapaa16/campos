"use client";

import * as React from "react";
import { Avatar as A, Checkbox as C, Separator as Sep, Switch as Sw, Tabs as Tb } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusTone } from "./status-chip";

/* ----------------------------------------------------------------- avatar -- */

const AVATAR_BG: Record<StatusTone, string> = {
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  plan: "bg-plan-soft text-plan",
  neutral: "bg-neutral-soft text-text-2",
};

/** Initials-only by design: no avatar uploads, so no stale photos of leavers. */
export function Avatar({
  name,
  tone = "neutral",
  size = "md",
  className,
}: {
  name: string;
  tone?: StatusTone;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const initials = name
    .replace(/^[А-ЯA-Z]\./, "") // "Б.Болд" → "Болд"
    .trim()
    .slice(0, 2)
    .toUpperCase();
  const sizes = { xs: "size-4 text-[9px]", sm: "size-5 text-2xs", md: "size-6 text-xs" };
  return (
    <A.Root
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none",
        AVATAR_BG[tone],
        sizes[size],
        className,
      )}
    >
      <A.Fallback>{initials}</A.Fallback>
    </A.Root>
  );
}

/* --------------------------------------------------------------- checkbox -- */

export function Checkbox({
  className,
  indeterminate,
  ...props
}: React.ComponentProps<typeof C.Root> & { indeterminate?: boolean }) {
  return (
    <C.Root
      checked={indeterminate ? "indeterminate" : props.checked}
      className={cn(
        "ui-transition flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-line-strong bg-surface-inset outline-none",
        "hover:border-accent-line focus-visible:ring-2 focus-visible:ring-accent-soft",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        className,
      )}
      {...props}
    >
      <C.Indicator className="text-on-accent">
        {indeterminate ? <Minus className="size-2.5" strokeWidth={3} /> : <Check className="size-2.5" strokeWidth={3} />}
      </C.Indicator>
    </C.Root>
  );
}

/* ----------------------------------------------------------------- switch -- */

export function Switch({ className, ...props }: React.ComponentProps<typeof Sw.Root>) {
  return (
    <Sw.Root
      className={cn(
        "ui-transition peer inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-line-strong bg-surface-inset outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent-soft data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <Sw.Thumb className="ui-transition pointer-events-none block size-3 translate-x-0.5 rounded-full bg-text-2 data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-on-accent" />
    </Sw.Root>
  );
}

/* -------------------------------------------------------------- separator -- */

export function Separator({ className, ...props }: React.ComponentProps<typeof Sep.Root>) {
  return <Sep.Root className={cn("bg-line data-[orientation=horizontal]:h-px data-[orientation=vertical]:w-px", className)} {...props} />;
}

/* ------------------------------------------------------------------- tabs -- */

export const Tabs = Tb.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof Tb.List>) {
  return (
    <Tb.List
      className={cn("flex items-center gap-0.5 border-b border-line", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof Tb.Trigger>) {
  return (
    <Tb.Trigger
      className={cn(
        "ui-transition relative -mb-px border-b-2 border-transparent px-2.5 py-1.5 text-sm font-medium text-text-3 outline-none",
        "hover:text-text-2 focus-visible:ring-2 focus-visible:ring-accent-soft",
        "data-[state=active]:border-accent data-[state=active]:text-text",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = Tb.Content;

/* -------------------------------------------------------------------- kbd -- */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-line bg-surface-inset px-1 font-mono text-2xs font-medium text-text-3",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
