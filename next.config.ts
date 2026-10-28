import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Deliberately off. Every screen here is auth-gated and tenant-scoped, so it
  // reads cookies and renders dynamically by definition. Turning on component
  // caching would mean annotating every page as uncacheable anyway, while
  // risking a cached fragment leaking across tenants.
  cacheComponents: false,
  // The floating dev badge sits on top of the sidebar's user menu.
  devIndicators: false,
  experimental: {
    // forbidden() / unauthorized() render server-side with the right status.
    // Without this a denied page throws into the client error boundary, which
    // answers 200 with an empty server payload — wrong for monitoring, wrong
    // for the user, and invisible to any check that is not a real browser.
    authInterrupts: true,
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default withNextIntl(nextConfig);
