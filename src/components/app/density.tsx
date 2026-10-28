"use client";

import * as React from "react";
import { useLocalPreference } from "@/lib/use-debounced-search";

/**
 * Density is a first-class setting, not a style tweak.
 *
 * Control-room users want 28px rows and will take the hit in tap-target size;
 * an occasional admin on a laptop wants 44px. Both are correct, so the choice
 * belongs to the user and persists.
 */
export type Density = "comfortable" | "compact" | "dense";

const STORAGE_KEY = "campos.density";
const DEFAULT: Density = "compact";

function isDensity(value: string): value is Density {
  return value === "comfortable" || value === "compact" || value === "dense";
}

interface DensityContextValue {
  density: Density;
  setDensity: (d: Density) => void;
}

const DensityContext = React.createContext<DensityContextValue>({
  density: DEFAULT,
  setDensity: () => {},
});

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setStored] = useLocalPreference<Density>(STORAGE_KEY, DEFAULT, isDensity);

  // The attribute drives the CSS tokens, so it is an external system to keep
  // in sync — which is exactly what an effect is for.
  React.useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const value = React.useMemo(
    () => ({ density, setDensity: setStored }),
    [density, setStored],
  );
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity() {
  return React.useContext(DensityContext);
}

/**
 * Row height per density, in pixels.
 *
 * MUST match `--row-h` in src/styles/theme.css. The virtualizer positions
 * rows from these numbers while CSS paints the cells, so a disagreement makes
 * the list silently overlap or gap. A test asserts the two stay in step —
 * cheaper and more reliable than measuring the DOM at runtime.
 */
export const ROW_HEIGHT: Record<Density, number> = {
  comfortable: 44,
  compact: 36,
  dense: 28,
};

export function useRowHeight(): number {
  return ROW_HEIGHT[useDensity().density];
}
