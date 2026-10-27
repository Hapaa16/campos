/**
 * Minimal typings for d3-flextree, which ships none.
 *
 * Covers only the surface the org chart uses: build a hierarchy, run the
 * layout, walk the positioned nodes.
 */
declare module "d3-flextree" {
  export interface FlextreeNode<Datum> {
    data: Datum;
    depth: number;
    height: number;
    parent: FlextreeNode<Datum> | null;
    children?: FlextreeNode<Datum>[];
    /** Cross-axis position (across siblings). */
    x: number;
    /** Depth-axis position. */
    y: number;
    xSize: number;
    ySize: number;
    each(callback: (node: FlextreeNode<Datum>) => void): FlextreeNode<Datum>;
    descendants(): FlextreeNode<Datum>[];
  }

  export interface FlextreeLayout<Datum> {
    (root: FlextreeNode<Datum>): FlextreeNode<Datum>;
    hierarchy(
      data: Datum,
      children?: (datum: Datum) => Datum[] | null | undefined,
    ): FlextreeNode<Datum>;
  }

  export interface FlextreeOptions<Datum> {
    children?: (datum: Datum) => Datum[] | null | undefined;
    nodeSize?: (node: FlextreeNode<Datum>) => [number, number];
    spacing?: number | ((a: FlextreeNode<Datum>, b: FlextreeNode<Datum>) => number);
  }

  export function flextree<Datum>(options?: FlextreeOptions<Datum>): FlextreeLayout<Datum>;
}
