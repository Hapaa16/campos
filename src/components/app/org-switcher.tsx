"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { switchOrganizationAction } from "@/server/actions/session";
import { cn } from "@/lib/utils";

export interface OrgOption {
  id: string;
  name: string;
  slug: string;
}

/**
 * Switching tenants is a server round-trip, never a client-side filter change.
 *
 * The request re-issues the session after the server re-verifies membership;
 * a user who edits the slug in the URL gets a 404, not another tenant's data.
 */
export function OrgSwitcher({
  current,
  options,
}: {
  current: OrgOption;
  options: OrgOption[];
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const switchTo = (org: OrgOption) => {
    if (org.id === current.id) return;
    startTransition(async () => {
      const result = await switchOrganizationAction(org.id);
      if (result.ok && result.slug) {
        router.push(`/${result.slug}/dashboard`);
        router.refresh();
      }
    });
  };

  const trigger = (
    <button
      type="button"
      disabled={options.length < 2}
      className={cn(
        "ui-transition flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-left outline-none",
        options.length > 1 && "hover:bg-surface-3",
        "focus-visible:ring-2 focus-visible:ring-accent-soft",
      )}
    >
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-accent text-[10px] font-bold text-on-accent"
      >
        {current.name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight tracking-tight text-text">
          {current.name}
        </span>
      </span>
      {pending ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-text-3" />
      ) : options.length > 1 ? (
        <ChevronsUpDown className="size-3.5 shrink-0 text-text-3" />
      ) : null}
    </button>
  );

  if (options.length < 2) return trigger;

  return (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent align="start" className="min-w-56">
        <MenuLabel>{t("switchOrganization")}</MenuLabel>
        {options.map((org) => (
          <MenuItem key={org.id} onSelect={() => switchTo(org)} className="justify-between">
            <span className="truncate">{org.name}</span>
            {org.id === current.id && <Check className="size-3.5 text-accent" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
