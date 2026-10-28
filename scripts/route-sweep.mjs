/**
 * Route sweep.
 *
 * Signs in as every seeded role and requests every route, then prints a
 * matrix of status codes. Two things it proves that unit tests cannot:
 *   - the permission gating actually gates in the real request pipeline
 *   - nothing 500s under a role whose permissions I did not think about
 *
 * Also probes the other tenant with each session, which must never be 200.
 *
 * Usage: pnpm dev, then `node scripts/route-sweep.mjs`
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

/** route -> the data-page marker the real page emits when it renders. */
const ROUTES = [
  ["/dashboard", "dashboard"],
  ["/org-chart", "org-chart"],
  ["/workforce", "workforce"],
  ["/rosters", "rosters"],
  ["/camps", "camps"],
  ["/accommodation", "accommodation"],
  ["/approvals", "approvals"],
  ["/settings/roles", "settings-roles"],
  ["/attendance", "stub"],
  ["/transport", "stub"],
  ["/visitors", "stub"],
  ["/meals", "stub"],
  ["/reports", "stub"],
  ["/integrations", "stub"],
];

const USERS = [
  "admin@campos.mn", "hr@campos.mn", "designer@campos.mn", "planner@campos.mn",
  "approver@campos.mn", "camp@campos.mn", "transport@campos.mn", "boarding@campos.mn",
  "reception@campos.mn", "gate@campos.mn", "supervisor@campos.mn",
  "employee@campos.mn", "auditor@campos.mn", "erdenet@campos.mn", "platform@campos.mn",
];

async function signIn(email) {
  const res = await fetch(`${BASE}/api/v1/dev/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`${email}: ${res.status}`);
  const body = await res.json();
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("campos_session="));
  return { cookie: cookie.split(";")[0], slug: body.orgSlug, roleIds: body.roleIds };
}

/**
 * Next renders error.tsx and not-found.tsx with a 200, so the status code
 * alone says nothing about whether the guard fired. Classify by what the page
 * actually rendered.
 */
async function classify(res, marker) {
  if (res.status >= 500) return { symbol: "!!", broken: true };
  if (res.status === 307 || res.status === 302) return { symbol: "→", broken: false };
  if (res.status === 404) return { symbol: "✗", broken: false };
  if (res.status !== 200) return { symbol: String(res.status), broken: false };

  const html = await res.text();
  // The page's own marker is the only reliable signal. Status is 200 even for
  // a streamed error page, and every translated string — plus every boundary
  // component — ships in the payload regardless of what rendered.
  const rendered =
    html.includes(`data-page="${marker}"`) || html.includes(`data-page\\":\\"${marker}`);
  if (rendered) return { symbol: "·", broken: false };

  // Nothing rendered and nothing crashed: the guard refused.
  const crashed = html.includes("digest") && html.includes("__next_error__");
  return { symbol: crashed ? "!!" : "✗", broken: crashed };
}
const rows = [];
let failures = 0;

for (const email of USERS) {
  const { cookie, slug, roleIds } = await signIn(email);
  const cells = [];

  for (const [route, marker] of ROUTES) {
    const res = await fetch(`${BASE}/${slug}${route}`, { headers: { cookie }, redirect: "manual" });
    const verdict = await classify(res, marker);
    if (verdict.broken) {
      failures++;
      console.error(`CRASH ${email} ${route}`);
    }
    cells.push(verdict.symbol);
  }

  // Cross-tenant: a session must not render another organization's data.
  // A member of both tenants legitimately gets redirected through the switch
  // route; a non-member must get nothing.
  const other = slug === "erdenet" ? "oyu-tolgoi" : "erdenet";
  const cross = await fetch(`${BASE}/${other}/dashboard`, { headers: { cookie }, redirect: "manual" });
  const crossVerdict = await classify(cross, "dashboard");
  const isMemberOfBoth = roleIds.includes("platform.superadmin");
  const crossOk = isMemberOfBoth
    ? crossVerdict.symbol === "→" || crossVerdict.symbol === "·"
    : crossVerdict.symbol === "✗";
  if (!crossOk) {
    failures++;
    console.error(`CROSS-TENANT ${email} reached ${other}: ${crossVerdict.symbol}`);
  }

  rows.push({ email, roleIds: roleIds.join(","), cells, cross: crossVerdict.symbol, crossOk });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("role", 24) + ROUTES.map(([r]) => pad(r.replace("/", "").slice(0, 6), 7)).join("") + " cross",
);
console.log("-".repeat(24 + ROUTES.length * 7 + 7));
for (const row of rows) {
  console.log(
    pad(row.roleIds.slice(0, 23), 24) +
      row.cells.map((c) => pad(c, 7)).join("") +
      ` ${row.cross}${row.crossOk ? "" : "  <-- LEAK"}`,
  );
}
console.log("\n·=200  ✗=denied  →=redirect  !!=server error");
console.log(failures === 0 ? "\nsweep clean" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
