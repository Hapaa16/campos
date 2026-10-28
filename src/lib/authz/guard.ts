import "server-only";
import { cache } from "react";
import { buildAbility } from "./ability";
import type { Action, Subject } from "./types";
import { forbidden, unauthorized } from "next/navigation";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { canOn, canType } from "./ability";
import { getAuthContext } from "@/server/auth/session";
import { db } from "@/server/db/store";
import type { DataContext } from "@/server/db/query";

/* ===========================================================================
   Layer 2 — the server guard.

   Real enforcement. Every page, layout, route handler and server action that
   touches tenant data calls into here. Middleware (layer 1) only redirects;
   this is what refuses.

   `cache()` dedupes the session lookup and ability construction across a single
   render pass, so a page that guards in five places still resolves once.
   ========================================================================= */

export const getContext = cache(async (): Promise<DataContext | null> => {
  const auth = await getAuthContext();
  if (!auth) return null;
  // Resolve against the stored catalogue, so a permission edited in Settings
  // applies on the next request rather than at the next deploy.
  return { auth, ability: buildAbility(auth, db().roles) };
});

export async function requireContext(): Promise<DataContext> {
  const ctx = await getContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

/**
 * Page-entry guard — "may this actor open this screen at all?".
 *
 * Calls Next's forbidden()/unauthorized() rather than throwing, so a denial
 * renders server-side with a 403 and a real page. Throwing instead lands in
 * the client error boundary, which answers 200 with nothing in the server
 * HTML — indistinguishable from a working page to anything but a browser.
 *
 * It CANNOT evaluate row conditions, so it is never sufficient on its own for
 * a mutation: pair it with requireOn().
 */
export async function requireAbility(action: Action, subject: Subject): Promise<DataContext> {
  const ctx = await getContext();
  if (!ctx) unauthorized();
  if (!canType(ctx.ability, action, subject)) forbidden();
  return ctx;
}

/** Assert a permission against a concrete record. This is the real check. */
export async function requireOn<T extends object>(
  action: Action,
  subject: Subject,
  record: T,
): Promise<DataContext> {
  const ctx = await requireContext();
  if (!canOn(ctx.ability, action, subject, record)) {
    throw new ForbiddenError(
      ctx.ability.relevantRuleFor(action, subject as never)?.reason ??
        "Энэ үйлдлийг гүйцэтгэх эрх байхгүй.",
      { action, subject },
    );
  }
  return ctx;
}

/** Non-throwing variant, for conditionally rendering a section. */
export async function may(action: Action, subject: Subject): Promise<boolean> {
  const ctx = await getContext();
  return ctx ? canType(ctx.ability, action, subject) : false;
}
