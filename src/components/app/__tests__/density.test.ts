import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROW_HEIGHT, type Density } from "../density";

/**
 * The virtualizer positions rows from ROW_HEIGHT while CSS paints them from
 * --row-h. If those ever disagree the list overlaps or gaps, and it is the
 * kind of bug that only shows up at one density on one screen.
 */
describe("density tokens agree between CSS and JS", () => {
  const css = readFileSync("src/styles/theme.css", "utf8");

  const cssRowHeight = (density: Density): number => {
    // `dense` and `compact` have their own selector blocks; `comfortable` is
    // defined on the shared :root rule.
    const selector =
      density === "comfortable"
        ? /:root,\s*\n:root\[data-density="comfortable"\]\s*\{([^}]*)\}/
        : new RegExp(`:root\\[data-density="${density}"\\]\\s*\\{([^}]*)\\}`);

    const block = css.match(selector);
    expect(block, `no CSS block for density "${density}"`).not.toBeNull();

    const value = block![1].match(/--row-h:\s*(\d+)px/);
    expect(value, `--row-h missing for density "${density}"`).not.toBeNull();
    return Number(value![1]);
  };

  it.each(["comfortable", "compact", "dense"] as const)("%s", (density) => {
    expect(cssRowHeight(density)).toBe(ROW_HEIGHT[density]);
  });

  it("orders the densities as the names imply", () => {
    expect(ROW_HEIGHT.comfortable).toBeGreaterThan(ROW_HEIGHT.compact);
    expect(ROW_HEIGHT.compact).toBeGreaterThan(ROW_HEIGHT.dense);
  });
});
