# CampOS

Workforce, roster, camp and transport operations for remote industrial sites.
Mongolian-first (`mn`), with English available.

**Status:** Phase 1–3 plus Attendance. Dashboard, Org chart, Workforce,
Rosters, Camps, Accommodation and Attendance are built. Transport, Visitors,
Meals, Reports and Integrations are permission-gated stubs that state what
they will do — deliberately not empty screens that look like real ones with
no data.

## Running it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

The login screen lists one seeded account per role (password `demo`). Picking
different ones is the fastest way to see how much the interface changes with
permissions. Both the account list and the credential-free dev sign-in
endpoint are disabled in production builds.

```bash
pnpm check          # typecheck + lint + i18n + unit tests
pnpm check:routes   # every role x every route, against a running dev server
```

`pnpm start` refuses to boot in production without a `SESSION_SECRET` of at
least 32 characters.

## Authorization

The part worth reading first. A permission is an `(action, subject, scope)`
tuple; **no code anywhere branches on a role name**, and the 15 seeded roles
are data that `Settings → Roles` edits.

Five layers, each with a defined job:

| Layer | Where | Job | Weight |
|---|---|---|---|
| 1 | `src/proxy.ts` | Is there a validly-signed session? Redirect only. | **Gate, not guard** |
| 2 | `src/lib/authz/guard.ts` | Page entry and action authorization. | Real |
| 3 | `src/server/db/query.ts` | Tenant predicate applied *inside* the builder, then row conditions. | Real |
| 4 | `src/components/app/ability-provider.tsx` | Hide controls, pick the dashboard. | **Cosmetic** |
| 5 | `src/server/serialize/pii.ts` | Strip personal fields server-side before serialization. | Real |

Layer 4 is cosmetic by design and says so in the file. Anyone can flip a
boolean in devtools; layers 2, 3 and 5 are what refuse the request.

The session cookie carries only `userId`, the requested organization and a
permission generation — **not** roles. Roles are re-read per request, so a
forged or stale cookie cannot grant anything, and revoking a role invalidates
live sessions.

## Separations the model will not collapse

These are enforced in `src/server/db/invariants.ts` and asserted in tests:

- A booking is a plan; a check-in is an event; occupancy counts events.
- A roster assignment is a plan; attendance is an event. Attendance is never
  materialised — the daily view is a projection of roster + clock events +
  leave + corrections, so a late punch or a retroactive leave approval changes
  the answer rather than leaving a stale row behind.
- Sleeping in camp, turning up for work and being rostered are three separate
  facts. `/attendance` has a reconciliation panel whose entire purpose is to
  show where they disagree.
- Approved leave outranks absence: someone on leave is *excused*, never
  *absent*. The two are different claims about a person.
- A shift that has not ended cannot be an absence.
- A supervisor correction overrides the conclusion, never the evidence: the
  derived status is kept alongside the override, with actor and reason.
- Published roster rows keep the org-unit paths they were published with. A
  restructure rewrites current state only.
- Rest days store no row — absence of a row *is* the rest day.
- Bed bookings use half-open ranges, mirroring the Postgres `EXCLUDE`
  constraint, so back-to-back stays are legal and overlaps are not.
- Bus seat capacity is computed per overlapping leg, not by headcount. (The
  algorithm is built and tested; the transport screens are not.)

## Stack

Next.js 16 · React 19 · Tailwind v4 · CASL · next-intl · TanStack Table v9 +
Virtual · xyflow + d3-flextree · Zod · date-fns · Vitest

## Data

An in-memory store seeded deterministically: two tenants, ~1,300 employees,
600+ beds, ~58k roster assignments. It enforces the real business rules rather
than being a permissive fake, so the UI is developed against truth.

Swapping in the real Fastify API is a transport change: the service layer in
`src/server/services/` is the seam.

## Known gaps

- `@tanstack/react-virtual` is skipped by the React Compiler (3 lint
  warnings). Library limitation, not fixable here.
- Roles are editable by removing rules; adding a rule from the UI is not built.
- No automated visual-regression baseline; theme and density were checked by
  hand across the main screens.
