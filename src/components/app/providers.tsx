"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DensityProvider } from "./density";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Operational data goes stale quickly — a bed count from five minutes
        // ago is misinformation, not a cache hit.
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <DensityProvider>
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>
            <TooltipProvider delayDuration={350} skipDelayDuration={200}>
              {children}
              <Toaster
                position="bottom-right"
                toastOptions={{
                  classNames: {
                    toast:
                      "!bg-surface-2 !border-line !text-text !rounded-[var(--radius-card)] !shadow-[var(--shadow-overlay)] !text-sm",
                    description: "!text-text-3",
                  },
                }}
              />
            </TooltipProvider>
          </NuqsAdapter>
        </QueryClientProvider>
      </DensityProvider>
    </ThemeProvider>
  );
}
