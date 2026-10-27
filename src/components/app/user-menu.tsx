"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Check, LogOut, Monitor, Moon, Rows3, Sun } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { useDensity, type Density } from "./density";
import { Link, usePathname } from "@/i18n/navigation";
import { signOutAction } from "@/server/actions/session";
import type { StatusTone } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

export function UserMenu({
  name,
  email,
  roleLabels,
  tone,
  collapsed,
}: {
  name: string;
  email: string;
  roleLabels: string[];
  tone: StatusTone;
  collapsed?: boolean;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const signOut = () => {
    void signOutAction();
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "ui-transition flex w-full items-center gap-2 rounded-[var(--radius-control)] p-1 text-left outline-none hover:bg-surface-3",
            "focus-visible:ring-2 focus-visible:ring-accent-soft",
            collapsed && "w-auto justify-center",
          )}
        >
          <Avatar name={name} tone={tone} size="md" />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight text-text">{name}</span>
              <span className="block truncate text-2xs leading-tight text-text-3">
                {roleLabels.join(" · ")}
              </span>
            </span>
          )}
        </button>
      </MenuTrigger>

      <MenuContent align="start" side="top" className="min-w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium text-text">{name}</p>
          <p className="truncate text-xs text-text-3">{email}</p>
          <p className="mt-1 truncate text-2xs text-text-3">{roleLabels.join(" · ")}</p>
        </div>
        <MenuSeparator />

        <MenuLabel>{t("theme.label")}</MenuLabel>
        <MenuRadioGroup value={mounted ? theme : undefined} onValueChange={setTheme}>
          <MenuRadioItem value="dark">
            <Moon /> {t("theme.dark")}
          </MenuRadioItem>
          <MenuRadioItem value="light">
            <Sun /> {t("theme.light")}
          </MenuRadioItem>
          <MenuRadioItem value="system">
            <Monitor /> {t("theme.system")}
          </MenuRadioItem>
        </MenuRadioGroup>

        <MenuSeparator />
        <MenuLabel>{t("density.label")}</MenuLabel>
        <MenuRadioGroup value={density} onValueChange={(v) => setDensity(v as Density)}>
          {(["comfortable", "compact", "dense"] as const).map((d) => (
            <MenuRadioItem key={d} value={d}>
              <Rows3 /> {t(`density.${d}`)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>

        <MenuSeparator />
        <MenuLabel>Хэл / Language</MenuLabel>
        {(["mn", "en"] as const).map((l) => (
          <MenuItem key={l} asChild>
            <Link href={pathname} locale={l} className="justify-between">
              <span>{l === "mn" ? "Монгол" : "English"}</span>
              {locale === l && <Check className="size-3.5 text-accent" />}
            </Link>
          </MenuItem>
        ))}

        <MenuSeparator />
        <MenuItem onSelect={signOut} className="text-danger data-[highlighted]:text-danger">
          <LogOut /> {t("auth.signOut")}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
