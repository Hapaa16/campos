"use client";

import * as React from "react";

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

interface DensityContextValue {
  density: Density;
  setDensity: (d: Density) => void;
}

const DensityContext = React.createContext<DensityContextValue>({
  density: DEFAULT,
  setDensity: () => {},
});

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = React.useState<Density>(DEFAULT);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Density | null;
    if (stored === "comfortable" || stored === "compact" || stored === "dense") {
      setDensityState(stored);
      document.documentElement.dataset.density = stored;
    }
  }, []);

  const setDensity = React.useCallback((d: Density) => {
    setDensityState(d);
    document.documentElement.dataset.density = d;
    window.localStorage.setItem(STORAGE_KEY, d);
  }, []);

  const value = React.useMemo(() => ({ density, setDensity }), [density, setDensity]);
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity() {
  return React.useContext(DensityContext);
}

/** Pixel row height for the active density — for virtualizer measurements. */
export const ROW_HEIGHT: Record<Density, number> = {
  comfortable: 44,
  compact: 36,
  dense: 28,
};
