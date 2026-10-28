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
  pageKey,
  title,
  meta,
  actions,
}: {
  /**
   * Stable identifier emitted into the markup.
   *
   * Proof that this page rendered, for automated permission checks: a denied
   * page streams with a 200 and carries the whole message catalogue, so
   * neither status nor translated copy can tell "rendered" from "refused".
   */
  pageKey: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  usePageHeader({ title, meta, actions });
  return <span data-page={pageKey} hidden />;
}
