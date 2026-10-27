"use client";

import * as React from "react";
import { createMongoAbility, type RawRuleFrom } from "@casl/ability";
import { unpackRules, type PackRule } from "@casl/ability/extra";
import { canOn, canType, type AppAbility } from "@/lib/authz/ability";
import type { Action, Subject } from "@/lib/authz/types";

/* ===========================================================================
   Layer 4 — the UI.

   COSMETIC ONLY. Everything here exists so the interface does not offer a
   button that would fail, and so a role sees a navigation tree that matches
   its job. None of it is security.

   Anyone can open devtools, flip a boolean, and make a hidden control appear.
   That is fine and expected: layers 2, 3 and 5 on the server are what refuse
   the request when they click it. If a check only exists in this file, the
   feature is unprotected.
   ========================================================================= */

const AbilityContext = React.createContext<AppAbility | null>(null);

export function AbilityProvider({
  rules,
  children,
}: {
  rules: PackRule<RawRuleFrom<[Action, Subject], Record<string, unknown>>>[];
  children: React.ReactNode;
}) {
  const ability = React.useMemo(
    () =>
      createMongoAbility(unpackRules(rules), {
        detectSubjectType: (obj) =>
          (obj as { __caslSubjectType__?: string }).__caslSubjectType__ as Subject,
      }) as AppAbility,
    [rules],
  );

  return <AbilityContext.Provider value={ability}>{children}</AbilityContext.Provider>;
}

export function useAbility(): AppAbility {
  const ability = React.useContext(AbilityContext);
  if (!ability) {
    throw new Error("useAbility must be used inside <AbilityProvider>.");
  }
  return ability;
}

/** Type-level permission, for showing or hiding a control. */
export function usePermission(action: Action, subject: Subject): boolean {
  const ability = useAbility();
  return React.useMemo(() => canType(ability, action, subject), [ability, action, subject]);
}

/** Record-level permission, for a row action. */
export function usePermissionOn(action: Action, subject: Subject, record: object | null): boolean {
  const ability = useAbility();
  return React.useMemo(
    () => (record ? canOn(ability, action, subject, record) : false),
    [ability, action, subject, record],
  );
}

/**
 * Render children only when permitted.
 *
 * `fallback` is for the cases where silence is worse than a locked door —
 * a disabled button with a reason beats a control that mysteriously is not
 * there. Default is to render nothing.
 */
export function Can({
  I,
  a,
  on,
  children,
  fallback = null,
}: {
  I: Action;
  a: Subject;
  on?: object | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const ability = useAbility();
  const allowed = on ? canOn(ability, I, a, on) : canType(ability, I, a);
  return <>{allowed ? children : fallback}</>;
}

/** Why an action is refused, for an honest disabled-state tooltip. */
export function useDenialReason(action: Action, subject: Subject): string | null {
  const ability = useAbility();
  return React.useMemo(() => {
    if (canType(ability, action, subject)) return null;
    return ability.relevantRuleFor(action, subject as never)?.reason ?? null;
  }, [ability, action, subject]);
}
