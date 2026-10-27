import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/store";
import { findMembership, getCurrentUser, signSession, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { SESSION_TTL_SECONDS } from "@/lib/auth/token";

/**
 * Switch tenant from a link — e.g. a bookmark into an organization that is not
 * the one the current session names.
 *
 * Membership is verified here before the cookie is rewritten. A user who edits
 * the `org` parameter to a tenant they do not belong to is sent to /, not in.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const organizationId = request.nextUrl.searchParams.get("org");
  const membership = organizationId ? findMembership(user, organizationId) : null;
  if (!membership) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const org = db().organizations.find((o) => o.id === membership.organizationId);
  if (!org) return NextResponse.redirect(new URL("/", request.url));

  const target = request.nextUrl.searchParams.get("to");
  // Only same-origin relative paths; an absolute URL here would be an open redirect.
  const safeTarget = target && target.startsWith("/") && !target.startsWith("//")
    ? target
    : `/${org.slug}/dashboard`;

  const token = await signSession({ sub: user.id, org: org.id, pv: user.permVersion });

  const response = NextResponse.redirect(new URL(safeTarget, request.url));
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
