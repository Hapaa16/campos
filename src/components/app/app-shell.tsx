"use client";

import * as React from "react";
import type { RawRuleFrom } from "@casl/ability";
import type { PackRule } from "@casl/ability/extra";
import { AbilityProvider } from "./ability-provider";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { OrgSwitcher, type OrgOption } from "./org-switcher";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { UserMenu } from "./user-menu";
import type { Action, Subject } from "@/lib/authz/types";
import type { StatusTone } from "@/components/ui/status-chip";

export interface ShellUser {
  name: string;
  email: string;
  roleLabels: string[];
  tone: StatusTone;
}

/** Set by a page to drive the topbar without prop-drilling through layouts. */
const PageHeaderContext = React.createContext<{
  setHeader: (h: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode }) => void;
}>({ setHeader: () => {} });

export function usePageHeader(header: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { setHeader } = React.useContext(PageHeaderContext);
  const { title, meta, actions } = header;

  // Depend on the three fields, not on the object: callers build a new object
  // literal every render, so an object dependency would re-publish forever.
  React.useEffect(() => {
    setHeader({ title, meta, actions });
  }, [title, meta, actions, setHeader]);
}

export function AppShell({
  rules,
  org,
  orgOptions,
  user,
  defaultTitle,
  children,
}: {
  rules: PackRule<RawRuleFrom<[Action, Subject], Record<string, unknown>>>[];
  org: OrgOption;
  orgOptions: OrgOption[];
  user: ShellUser;
  defaultTitle: string;
  children: React.ReactNode;
}) {
  const palette = useCommandPalette();
  const [header, setHeader] = React.useState<{
    title: React.ReactNode;
    meta?: React.ReactNode;
    actions?: React.ReactNode;
  }>({ title: defaultTitle });

  const ctx = React.useMemo(() => ({ setHeader }), []);

  return (
    <AbilityProvider rules={rules}>
      <PageHeaderContext.Provider value={ctx}>
        <div className="flex h-dvh overflow-hidden bg-canvas">
          <Sidebar
            orgSlug={org.slug}
            header={<OrgSwitcher current={org} options={orgOptions} />}
            footer={
              <UserMenu
                name={user.name}
                email={user.email}
                roleLabels={user.roleLabels}
                tone={user.tone}
              />
            }
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar
              title={header.title}
              meta={header.meta}
              actions={header.actions}
              onOpenPalette={() => palette.setOpen(true)}
            />
            {/* A flex column, so a page can own the remaining height with
                flex-1 (canvases and virtualized tables need a definite one)
                and manage its own scrolling. */}
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
          </div>
        </div>

        <CommandPalette open={palette.open} onOpenChange={palette.setOpen} orgSlug={org.slug} />
      </PageHeaderContext.Provider>
    </AbilityProvider>
  );
}
