"use server";

import { redirect } from "next/navigation";
import { db } from "@/server/db/store";
import {
  clearSessionCookie,
  findMembership,
  getCurrentUser,
  setSessionCookie,
  signSession,
} from "@/server/auth/session";

/* ===========================================================================
   Session actions.

   Sign-in and tenant switching both end in the same place: the server decides
   which organization the token may name, after checking membership. The client
   never gets to assert a tenant.
   ========================================================================= */

export interface SignInResult {
  ok: boolean;
  error?: string;
  redirectTo?: string;
}

export async function signInAction(
  _prev: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const user = db().users.find((u) => u.email.toLowerCase() === email);

  // Demo credential check. A real deployment verifies an argon2id hash and
  // applies rate limiting and lockout here.
  if (!user || user.status !== "active" || user.devPassword !== password) {
    return { ok: false, error: "invalid" };
  }

  const membership = user.memberships[0];
  if (!membership) return { ok: false, error: "no_membership" };

  const token = await signSession({
    sub: user.id,
    org: membership.organizationId,
    pv: user.permVersion,
  });
  await setSessionCookie(token);

  const org = db().organizations.find((o) => o.id === membership.organizationId)!;
  return { ok: true, redirectTo: next || `/${org.slug}/dashboard` };
}

export async function signOutAction() {
  await clearSessionCookie();
  redirect("/login");
}

/**
 * Switch the active tenant.
 *
 * Membership is re-verified here against the store. A user who forges the
 * organization id gets an error, not a new tenant — the id in the request is
 * a request, and this function is the only thing that can turn it into a grant.
 */
export async function switchOrganizationAction(organizationId: string): Promise<{ ok: boolean; slug?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  const membership = findMembership(user, organizationId);
  if (!membership) return { ok: false };

  const token = await signSession({
    sub: user.id,
    org: membership.organizationId,
    pv: user.permVersion,
  });
  await setSessionCookie(token);

  const org = db().organizations.find((o) => o.id === organizationId);
  return { ok: true, slug: org?.slug };
}
