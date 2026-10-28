import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["mn", "en"],
  defaultLocale: "mn",
  // Mongolian is the working language; the prefix is only added for English
  // so the common case stays at clean, unprefixed URLs.
  localePrefix: "as-needed",
  // Deliberately off. Browsers on a Mongolian site commonly report en-US, so
  // negotiating from Accept-Language would hand the English UI to people who
  // never asked for it. English is reached by choosing it, not by inference.
  localeDetection: false,
});

/**
 * All formatting happens in the site's zone, not the viewer's.
 *
 * It must be passed explicitly to the client provider: without it the server
 * formats in Ulaanbaatar and the browser formats in whatever zone the user's
 * machine is set to, which is a hydration mismatch on every date on the page.
 */
export const APP_TIME_ZONE = "Asia/Ulaanbaatar";

export type Locale = (typeof routing.locales)[number];
