"use client";

import * as React from "react";

/**
 * A text input that mirrors an external value and commits back on a debounce.
 *
 * Mirroring with an effect (`useEffect(() => setDraft(value), [value])`) causes
 * a cascading render and is what the React Compiler's lint rule objects to.
 * React's documented alternative is to adjust state during render when the
 * incoming prop changes, which is what the `lastExternal` check does.
 */
export function useDebouncedSearch(
  external: string,
  commit: (value: string) => void,
  delayMs = 250,
) {
  const [draft, setDraft] = React.useState(external);
  const [lastExternal, setLastExternal] = React.useState(external);

  // Render-time adjustment: the external value changed under us (a cleared
  // filter, a back navigation), so the draft follows it.
  if (external !== lastExternal) {
    setLastExternal(external);
    setDraft(external);
  }

  React.useEffect(() => {
    if (draft === external) return;
    const id = setTimeout(() => commit(draft), delayMs);
    return () => clearTimeout(id);
    // `commit` is recreated per render by callers; depending on it would
    // restart the timer on every keystroke-triggered render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, external, delayMs]);

  return [draft, setDraft] as const;
}

/**
 * Reads a persisted UI preference without a setState-in-effect cascade.
 *
 * `useSyncExternalStore` is the right tool: localStorage is an external store,
 * and the server snapshot keeps SSR and the first client render in agreement.
 */
export function useLocalPreference<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string) => value is T,
): [T, (next: T) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    // Other tabs changing the same preference should be picked up too.
    window.addEventListener("storage", onChange);
    window.addEventListener("campos:preference", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("campos:preference", onChange);
    };
  }, []);

  const getSnapshot = React.useCallback(() => {
    const stored = window.localStorage.getItem(key);
    return stored !== null && isValid(stored) ? stored : fallback;
  }, [key, fallback, isValid]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, () => fallback);

  const set = React.useCallback(
    (next: T) => {
      window.localStorage.setItem(key, next);
      window.dispatchEvent(new Event("campos:preference"));
    },
    [key],
  );

  return [value, set];
}
