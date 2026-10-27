"use client";

import * as React from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Monitor, Moon, Rows3, Search, Sun } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/misc";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { canType } from "@/lib/authz/ability";
import { useAbility } from "./ability-provider";
import { useDensity, type Density } from "./density";
import { cn } from "@/lib/utils";

/**
 * Cmd+K reaches every action — but only the ones this role may actually run.
 *
 * Filtering by ability is not just tidiness: a palette that lists "Publish
 * roster" to a planner who cannot publish teaches the user the wrong model of
 * their own permissions.
 */
export function CommandPalette({
  open,
  onOpenChange,
  orgSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const ability = useAbility();
  const { setTheme } = useTheme();
  const { setDensity } = useDensity();

  const navItems = React.useMemo(
    () => ALL_NAV_ITEMS.filter((i) => canType(ability, i.permission.action, i.permission.subject)),
    [ability],
  );

  const run = React.useCallback(
    (fn: () => void) => {
      onOpenChange(false);
      // Let the dialog close before navigating, so focus returns cleanly.
      requestAnimationFrame(fn);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg" className="top-[18%] translate-y-0 overflow-hidden p-0">
        <Command
          label={t("palette.placeholder")}
          loop
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-3"
        >
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-text-3" aria-hidden />
            <Command.Input
              placeholder={t("palette.placeholder")}
              className="h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-3"
            />
            <Kbd>ESC</Kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-sm text-text-3">
              {t("palette.empty")}
            </Command.Empty>

            <Command.Group heading={t("palette.navigation")}>
              {navItems.map((item) => (
                <PaletteItem
                  key={item.key}
                  onSelect={() => run(() => router.push(`/${orgSlug}${item.href}`))}
                >
                  <item.icon className="size-3.5 text-text-3" aria-hidden />
                  {t(item.labelKey)}
                  {item.stubPhase && (
                    <span className="ml-auto text-2xs text-text-3">{t("stub.comingSoon")}</span>
                  )}
                </PaletteItem>
              ))}
            </Command.Group>

            <Command.Group heading={t("palette.preferences")}>
              <PaletteItem onSelect={() => run(() => setTheme("dark"))}>
                <Moon className="size-3.5 text-text-3" aria-hidden /> {t("theme.dark")}
              </PaletteItem>
              <PaletteItem onSelect={() => run(() => setTheme("light"))}>
                <Sun className="size-3.5 text-text-3" aria-hidden /> {t("theme.light")}
              </PaletteItem>
              <PaletteItem onSelect={() => run(() => setTheme("system"))}>
                <Monitor className="size-3.5 text-text-3" aria-hidden /> {t("theme.system")}
              </PaletteItem>
              {(["comfortable", "compact", "dense"] as const).map((d: Density) => (
                <PaletteItem key={d} onSelect={() => run(() => setDensity(d))}>
                  <Rows3 className="size-3.5 text-text-3" aria-hidden /> {t("density.label")} ·{" "}
                  {t(`density.${d}`)}
                </PaletteItem>
              ))}
            </Command.Group>
          </Command.List>

          <div className="border-t border-line px-3 py-2 text-2xs text-text-3">
            {t("palette.hint")}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function PaletteItem({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "ui-transition flex cursor-default select-none items-center gap-2 rounded-[var(--radius-chip)] px-2.5 py-1.5 text-sm text-text-2",
        "data-[selected=true]:bg-surface-3 data-[selected=true]:text-text",
      )}
    >
      {children}
    </Command.Item>
  );
}

/** Registers ⌘K / Ctrl+K globally. */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
