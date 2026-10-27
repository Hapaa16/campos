import "server-only";
import "./fields"; // registers field catalogues — import for side effect
import { buildSeed, type Database } from "./seed";

/* ===========================================================================
   In-memory store.

   Stands in for PostgreSQL until the Fastify API exists. Cached on globalThis
   so Next's dev HMR does not reseed on every edit and wipe the state you were
   just looking at.
   ========================================================================= */

const globalRef = globalThis as typeof globalThis & { __camposDb?: Database };

export function db(): Database {
  if (!globalRef.__camposDb) globalRef.__camposDb = buildSeed();
  return globalRef.__camposDb;
}

/** Restore the seed. Used by tests and the dev "reset demo data" action. */
export function resetDb(): Database {
  globalRef.__camposDb = buildSeed();
  return globalRef.__camposDb;
}

export type { Database };
