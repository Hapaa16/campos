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

export type Locale = (typeof routing.locales)[number];
