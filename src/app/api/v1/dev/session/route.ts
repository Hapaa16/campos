import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/store";
import { signSession } from "@/server/auth/session";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth/token";

/* ===========================================================================
   DEVELOPMENT ONLY — mints a session for a seeded demo account.
   ---------------------------------------------------------------------------
   Exists so automated checks can drive the app as each role without scraping
   server-action ids out of the login HTML.

   It is a credential-free sign-in, so it is gated hard:
     - 404 (not 403) outside development, so it is not discoverable in prod
     - only seeded demo accounts, matched exactly
     - never reads anything from the request beyond an email

   If this file is ever reachable in production, that is a critical bug.
   ========================================================================= */

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const { email, organizationId } = (await request.json().catch(() => ({}))) as {
    email?: string;
    organizationId?: string;
  };

  const user = db().users.find((u) => u.email === email && u.devPassword === "demo");
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unknown demo account" }, { status: 400 });
  }

  const membership =
    (organizationId && user.memberships.find((m) => m.organizationId === organizationId)) ||
    user.memberships[0];
  if (!membership) {
    return NextResponse.json({ error: "no membership" }, { status: 400 });
  }

  const org = db().organizations.find((o) => o.id === membership.organizationId);
  const token = await signSession({
    sub: user.id,
    org: membership.organizationId,
    pv: user.permVersion,
  });

  const response = NextResponse.json({
    ok: true,
    userId: user.id,
    orgSlug: org?.slug ?? null,
    roleIds: membership.roleIds,
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
