"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function Topbar({
  title,
  meta,
  actions,
  onOpenPalette,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  onOpenPalette: () => void;
}) {
  const t = useTranslations();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-md font-semibold tracking-tight text-text">{title}</h1>
        {meta && <span className="truncate text-xs text-text-3">{meta}</span>}
      </div>

      <div className="flex-1" />

      {actions && <div className="flex items-center gap-1.5">{actions}</div>}

      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          "ui-transition flex h-[var(--control-h-sm)] items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface-inset pl-2 pr-1.5",
          "text-xs text-text-3 hover:border-line-strong hover:text-text-2 focus-visible:ring-2 focus-visible:ring-accent-soft",
        )}
      >
        <Search className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">{t("common.search")}</span>
        <Kbd className="ml-2">⌘K</Kbd>
      </button>
    </header>
  );
}
