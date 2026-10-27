import { flextree } from "d3-flextree";
import type { OrgTreeNode } from "@/server/services/org-units";

/* ===========================================================================
   Tree layout.

   d3-flextree rather than plain d3-hierarchy: flextree lets each node declare
   its own size, which matters because a Division card and a Team card are not
   the same width. d3-hierarchy would force one box size on both and leave
   gutters everywhere.
   ========================================================================= */

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 62;
const H_GAP = 24;
const V_GAP = 48;

export interface PositionedNode {
  node: OrgTreeNode;
  x: number;
  y: number;
  /** Children exist but are collapsed. */
  collapsedChildren: number;
}

export interface LayoutResult {
  nodes: PositionedNode[];
  edges: { id: string; source: string; target: string }[];
  width: number;
  height: number;
}

interface HierarchyDatum {
  id: string;
  node: OrgTreeNode;
  children: HierarchyDatum[];
  collapsedChildren: number;
}

export function layoutOrgTree(
  nodes: OrgTreeNode[],
  rootIds: string[],
  collapsed: ReadonlySet<string>,
): LayoutResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const build = (id: string): HierarchyDatum | null => {
    const node = byId.get(id);
    if (!node) return null;
    const isCollapsed = collapsed.has(id);
    const children = isCollapsed
      ? []
      : node.childIds.map(build).filter((c): c is HierarchyDatum => c !== null);
    return {
      id,
      node,
      children,
      collapsedChildren: isCollapsed ? node.childIds.length : 0,
    };
  };

  const roots = rootIds.map(build).filter((r): r is HierarchyDatum => r !== null);
  if (roots.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  // A synthetic root keeps multiple top-level units on one coherent canvas
  // without inventing a unit that does not exist in the data.
  const virtualRoot: HierarchyDatum = {
    id: "__root__",
    node: roots[0].node,
    children: roots,
    collapsedChildren: 0,
  };

  const layout = flextree<HierarchyDatum>({
    nodeSize: () => [NODE_WIDTH + H_GAP, NODE_HEIGHT + V_GAP],
    spacing: 0,
  });

  const tree = layout.hierarchy(virtualRoot, (d) => d.children);
  layout(tree);

  const positioned: PositionedNode[] = [];
  const edges: { id: string; source: string; target: string }[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;

  tree.each((point) => {
    const datum = point.data;
    if (datum.id === "__root__") return;

    // flextree lays out vertically by depth; shift up one level to remove the
    // synthetic root's row.
    const x = point.x;
    const y = (point.depth - 1) * (NODE_HEIGHT + V_GAP);

    positioned.push({ node: datum.node, x, y, collapsedChildren: datum.collapsedChildren });
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    for (const child of datum.children) {
      edges.push({ id: `${datum.id}->${child.id}`, source: datum.id, target: child.id });
    }
  });

  // Normalise so the leftmost node sits at x = 0.
  const offset = minX === Infinity ? 0 : minX;
  for (const p of positioned) p.x -= offset;

  return {
    nodes: positioned,
    edges,
    width: maxX - offset + NODE_WIDTH,
    height: maxY + NODE_HEIGHT,
  };
}

/** Ids on the path from a root down to `targetId`, so search can reveal it. */
export function ancestorsOf(nodes: OrgTreeNode[], targetId: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  let cursor = byId.get(targetId);
  while (cursor?.parentId) {
    chain.push(cursor.parentId);
    cursor = byId.get(cursor.parentId);
  }
  return chain;
}

/** Every descendant id of `rootId`, used to block a move into own subtree. */
export function descendantsOf(nodes: OrgTreeNode[], rootId: string): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const childId of byId.get(id)?.childIds ?? []) {
      if (out.has(childId)) continue;
      out.add(childId);
      walk(childId);
    }
  };
  walk(rootId);
  return out;
}
