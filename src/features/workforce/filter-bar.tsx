"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/utils";

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * Filters live in the URL, so a filtered view is a shareable link — which is
 * how a shift supervisor sends "these twelve people" to someone else.
 */
export function FilterBar({
  search,
  onSearchChange,
  facets,
  trailing,
  onClear,
  hasFilters,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  facets: {
    key: string;
    label: string;
    options: FacetOption[];
    selected: string[];
    onChange: (values: string[]) => void;
  }[];
  trailing?: React.ReactNode;
  onClear: () => void;
  hasFilters: boolean;
}) {
  const t = useTranslations("common");
  const [draft, setDraft] = React.useState(search);
  React.useEffect(() => setDraft(search), [search]);

  // Debounced so typing does not fire a server round-trip per keystroke.
  React.useEffect(() => {
    if (draft === search) return;
    const id = setTimeout(() => onSearchChange(draft), 250);
    return () => clearTimeout(id);
  }, [draft, search, onSearchChange]);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-3" aria-hidden />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
          className="h-[var(--control-h-sm)] w-56 pl-7"
        />
      </div>

      {facets.map((facet) => {
        const count = facet.selected.length;
        return (
          <Menu key={facet.key}>
            <MenuTrigger asChild>
              <Button variant={count ? "subtle" : "ghost"} size="sm">
                {facet.label}
                {count > 0 && (
                  <span className="tnum ml-1 rounded-[3px] bg-accent-soft px-1 text-2xs text-accent">
                    {count}
                  </span>
                )}
              </Button>
            </MenuTrigger>
            <MenuContent align="start" className="min-w-52">
              <MenuLabel>{facet.label}</MenuLabel>
              {facet.options.map((option) => (
                <MenuCheckboxItem
                  key={option.value}
                  checked={facet.selected.includes(option.value)}
                  onCheckedChange={(checked) =>
                    facet.onChange(
                      checked
                        ? [...facet.selected, option.value]
                        : facet.selected.filter((v) => v !== option.value),
                    )
                  }
                  className="relative justify-between"
                >
                  <span className="truncate">{option.label}</span>
                  {option.count !== undefined && (
                    <span className="tnum ml-2 text-2xs text-text-3">{option.count}</span>
                  )}
                </MenuCheckboxItem>
              ))}
              {facet.options.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-text-3">{t("noResults")}</p>
              )}
              {facet.selected.length > 0 && (
                <>
                  <MenuSeparator />
                  <button
                    type="button"
                    onClick={() => facet.onChange([])}
                    className={cn(
                      "ui-transition w-full rounded-[var(--radius-chip)] px-2 py-1.5 text-left text-sm text-text-3",
                      "hover:bg-surface-3 hover:text-text",
                    )}
                  >
                    {t("clearFilters")}
                  </button>
                </>
              )}
            </MenuContent>
          </Menu>
        );
      })}

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X /> {t("clearFilters")}
        </Button>
      )}

      <div className="ml-auto flex items-center gap-1.5">{trailing}</div>
    </div>
  );
}
