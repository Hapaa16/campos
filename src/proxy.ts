import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/token";

/* ===========================================================================
   Layer 1 — the gate.

   This is a GATE, NOT A GUARD. It answers one cheap question — "is there a
   validly-signed session?" — and redirects accordingly. It deliberately does
   not read the database, does not resolve roles, and does not decide whether
   the user belongs to the organization in the URL.

   That last check is the layout's job (layer 2), because confirming membership
   requires the store, and an authorization decision made in middleware is one
   made far away from the data it is protecting.
   ========================================================================= */

const intlMiddleware = createIntlMiddleware(routing);

const PUBLIC_PATHS = ["/login"];

function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

export default async function proxy(request: NextRequest) {
  const response = intlMiddleware(request);

  const path = stripLocale(request.nextUrl.pathname);
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const claims = token ? await verifySession(token) : null;

  if (!claims && !isPublic) {
    const url = new URL("/login", request.url);
    // Preserve where they were heading, so sign-in lands them there.
    if (path !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (claims && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  // Everything except Next internals, the API (which guards itself and must
  // answer 401 rather than redirect), and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
