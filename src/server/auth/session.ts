import "server-only";
import { cookies } from "next/headers";
import { db } from "@/server/db/store";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
  type SessionClaims,
} from "@/lib/auth/token";
import type { AuthContext } from "@/lib/authz/types";
import type { Membership, User } from "@/server/db/schema";

export { SESSION_COOKIE_NAME, signSession, verifySession };
export type { SessionClaims };

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);
}

export async function readSessionClaims(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/* ---------------------------------------------------------------------------
   Membership resolution — the step that actually enforces tenancy.
   --------------------------------------------------------------------------- */

export function findMembership(user: User, organizationId: string): Membership | null {
  return user.memberships.find((m) => m.organizationId === organizationId) ?? null;
}

export function toAuthContext(user: User, membership: Membership): AuthContext {
  return {
    userId: user.id,
    organizationId: membership.organizationId,
    employeeId: membership.employeeId,
    roleIds: membership.roleIds,
    siteIds: membership.siteIds,
    campIds: membership.campIds,
    orgUnitPath: membership.orgUnitPath,
    isPlatformAdmin: user.isPlatformAdmin,
    permVersion: user.permVersion,
  };
}

/**
 * Resolve the verified session into an AuthContext.
 *
 * Returns null — never a partially-trusted context — if the user is gone,
 * disabled, carrying a stale permission generation, or not a member of the
 * organization the token names. The tenant in the token is a *request*; this
 * function is where it becomes a grant, or does not.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const claims = await readSessionClaims();
  if (!claims) return null;

  const user = db().users.find((u) => u.id === claims.sub);
  if (!user || user.status !== "active") return null;
  if (user.permVersion !== claims.pv) return null;

  const membership = findMembership(user, claims.org);
  if (!membership) return null;

  return toAuthContext(user, membership);
}

export async function getCurrentUser(): Promise<User | null> {
  const claims = await readSessionClaims();
  if (!claims) return null;
  return db().users.find((u) => u.id === claims.sub) ?? null;
}

/** Organizations this user may switch into. */
export async function getAccessibleOrganizations() {
  const user = await getCurrentUser();
  if (!user) return [];
  const orgs = db().organizations;
  return user.memberships
    .map((m) => orgs.find((o) => o.id === m.organizationId))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));
}
