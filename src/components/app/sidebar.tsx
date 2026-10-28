"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { NAV_GROUPS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useAbility } from "./ability-provider";
import { canType } from "@/lib/authz/ability";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useLocalPreference } from "@/lib/use-debounced-search";

const COLLAPSE_KEY = "campos.sidebar.collapsed";

function isFlag(value: string): value is "0" | "1" {
  return value === "0" || value === "1";
}

export function Sidebar({
  orgSlug,
  header,
  footer,
}: {
  orgSlug: string;
  header: React.ReactNode;
  footer: React.ReactNode;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const ability = useAbility();
  const [flag, setFlag] = useLocalPreference<"0" | "1">(COLLAPSE_KEY, "0", isFlag);
  const collapsed = flag === "1";
  const toggle = () => setFlag(collapsed ? "0" : "1");

  // The nav tree is derived from permissions, so two roles genuinely see two
  // different products rather than the same one with dead links.
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      canType(ability, item.permission.action, item.permission.subject),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <nav
      aria-label={t("nav.dashboard")}
      data-collapsed={collapsed || undefined}
      className={cn(
        "ui-transition flex shrink-0 flex-col border-r border-line bg-canvas",
        collapsed ? "w-[52px]" : "w-[232px]",
      )}
    >
      <div className={cn("flex h-12 items-center border-b border-line", collapsed ? "justify-center px-1" : "px-2")}>
        {collapsed ? null : <div className="min-w-0 flex-1">{header}</div>}
        <Tooltip content={collapsed ? "Дэлгэх" : "Хураах"} side="right">
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={collapsed ? "Дэлгэх" : "Хураах"}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
        {groups.map((group) => (
          <div key={group.key} className="mb-3 last:mb-0">
            {group.labelKey && !collapsed && (
              <p className="px-2 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wider text-text-3">
                {t(group.labelKey)}
              </p>
            )}
            {group.labelKey && collapsed && <div className="mx-2 mb-1.5 mt-2 h-px bg-line" />}
            <ul className="space-y-px">
              {group.items.map((item) => {
                const href = `/${orgSlug}${item.href}`;
                const active =
                  pathname === href ||
                  pathname.startsWith(`${href}/`) ||
                  // /settings/roles should light up for any /settings/* route
                  (item.key === "settings" && pathname.startsWith(`/${orgSlug}/settings`));
                const label = t(item.labelKey);

                const link = (
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "ui-transition group flex h-7 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm outline-none",
                      "focus-visible:ring-2 focus-visible:ring-accent-soft",
                      active
                        ? "bg-accent-soft font-medium text-text"
                        : "text-text-2 hover:bg-surface-3 hover:text-text",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <item.icon
                      className={cn("size-4 shrink-0", active ? "text-accent" : "text-text-3 group-hover:text-text-2")}
                      aria-hidden
                    />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {!collapsed && item.stubPhase && (
                      <span className="ml-auto text-2xs font-medium text-text-3" title={t("stub.comingSoon")}>
                        ·
                      </span>
                    )}
                  </Link>
                );

                return (
                  <li key={item.key}>
                    {collapsed ? (
                      <Tooltip content={label} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className={cn("border-t border-line p-2", collapsed && "flex justify-center px-1")}>
        {footer}
      </div>
    </nav>
  );
}
