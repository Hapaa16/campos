import "server-only";
import "./fields"; // registers field catalogues — import for side effect
import { buildSeed, type Database } from "./seed";

/* ===========================================================================
   In-memory store.

   Stands in for PostgreSQL until the Fastify API exists. Cached on globalThis
   so Next's dev HMR does not reseed on every edit and wipe the state you were
   just looking at.
   ========================================================================= */

/**
 * Bump when the shape of `Database` changes.
 *
 * The globalThis cache survives HMR, so adding a table leaves the running dev
 * server holding a store without it — which surfaces as "cannot read
 * properties of undefined" rather than as anything resembling a schema error.
 * This is the migration marker in miniature.
 */
const SEED_VERSION = 2;

const globalRef = globalThis as typeof globalThis & {
  __camposDb?: Database;
  __camposSeedVersion?: number;
};

export function db(): Database {
  if (!globalRef.__camposDb || globalRef.__camposSeedVersion !== SEED_VERSION) {
    globalRef.__camposDb = buildSeed();
    globalRef.__camposSeedVersion = SEED_VERSION;
  }
  return globalRef.__camposDb;
}

/** Restore the seed. Used by tests and the dev "reset demo data" action. */
export function resetDb(): Database {
  globalRef.__camposDb = buildSeed();
  globalRef.__camposSeedVersion = SEED_VERSION;
  return globalRef.__camposDb;
}

export type { Database };
