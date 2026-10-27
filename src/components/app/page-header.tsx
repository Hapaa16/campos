"use client";

import * as React from "react";
import { usePageHeader } from "./app-shell";

/**
 * Pushes a page's title and actions up into the shared topbar.
 *
 * Renders nothing — it exists so a page can own its header without the layout
 * having to know every route, and without duplicating the bar on each screen.
 */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  usePageHeader({ title, meta, actions });
  return null;
}
