import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { APP_TIME_ZONE, routing } from "@/i18n/routing";
import { AppProviders } from "@/components/app/providers";
import "../globals.css";

/**
 * Inter, not Geist Sans: Inter ships complete Cyrillic coverage, and Geist's
 * is incomplete — Монгол labels would fall back mid-word to a system face.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  display: "swap",
});

/** Monospace is for aligned figures only, never body copy. */
const mono = Geist_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CampOS",
  description: "Ажиллах хүч, ээлж, кэмп, тээврийн нэгдсэн удирдлагын систем",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      // Dark is the base palette; next-themes rewrites these before paint.
      data-theme="dark"
      data-density="compact"
      suppressHydrationWarning
    >
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        {/* Locale and zone are passed explicitly: without them the client
            formatter falls back to the browser's, so the server renders
            "2026.09.28" and the browser renders "9/28/26" — a hydration
            mismatch on every date in the app. */}
        <NextIntlClientProvider locale={locale} timeZone={APP_TIME_ZONE}>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
