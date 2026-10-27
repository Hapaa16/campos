import { SignJWT, jwtVerify } from "jose";

/* ===========================================================================
   Session token.

   Edge-safe on purpose: no store access, no `server-only`, so the middleware
   gate can verify a token without pulling the database in. Deliberately
   minimal — the token says who you are and which tenant you asked for, and
   proves nothing about what you may do. Roles are read from the store on each
   request (see server/auth/session.ts).
   ========================================================================= */

export const SESSION_COOKIE_NAME = "campos_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionClaims {
  /** User id. */
  sub: string;
  /** Active organization id — a request to act there, not a grant. */
  org: string;
  /** Permission generation; bumped on role change to invalidate old tokens. */
  pv: number;
}

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production.");
    }
    return new TextEncoder().encode("dev-only-insecure-secret-do-not-ship");
  }
  return new TextEncoder().encode(value);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ org: claims.org, pv: claims.pv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.org !== "string") return null;
    return { sub: payload.sub, org: payload.org, pv: Number(payload.pv ?? 0) };
  } catch {
    return null;
  }
}
