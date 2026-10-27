import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["mn", "en"],
  defaultLocale: "mn",
  // Mongolian is the working language; the prefix is only added for English
  // so the common case stays at clean, unprefixed URLs.
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
