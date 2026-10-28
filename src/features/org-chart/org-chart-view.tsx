"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useTranslations } from "next-intl";
import { ChevronsDownUp, ChevronsUpDown, Maximize2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { usePermission } from "@/components/app/ability-provider";
import { UnitNode, type UnitFlowNode } from "./unit-node";
import { UnitPanel } from "./unit-panel";
import { MoveDialog } from "./move-dialog";
import { ancestorsOf, descendantsOf, layoutOrgTree, NODE_HEIGHT, NODE_WIDTH } from "./layout";
import type { OrgTree, OrgUnitDetail } from "@/server/services/org-units";

const nodeTypes = { unit: UnitNode };

export function OrgChartView(props: {
  tree: OrgTree;
  orgSlug: string;
  loadDetail: (unitId: string) => Promise<OrgUnitDetail | null>;
}) {
  return (
    <ReactFlowProvider>
      <OrgChartCanvas {...props} />
    </ReactFlowProvider>
  );
}

function OrgChartCanvas({
  tree,
  orgSlug,
  loadDetail,
}: {
  tree: OrgTree;
  orgSlug: string;
  loadDetail: (unitId: string) => Promise<OrgUnitDetail | null>;
}) {
  const t = useTranslations("org");
  const tc = useTranslations("common");
  const flow = useReactFlow();
  const mayRestructure = usePermission("update", "OrgUnit");

  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => {
    // Open on the top two levels only. Expanding the whole tree produces a
    // canvas so wide that fitView shrinks every label past legibility, and
    // the first question is always "what are the top-level groups".
    const initial = new Set<string>();
    for (const node of tree.nodes) {
      if (node.depth >= 1 && node.childIds.length > 0) initial.add(node.id);
    }
    return initial;
  });

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<OrgUnitDetail | null>(null);
  const [search, setSearch] = React.useState("");
  const [showReporting, setShowReporting] = React.useState(false);
  const [move, setMove] = React.useState<{ unitId: string; newParentId: string | null } | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const toggle = React.useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* -- search reveals rather than filters -------------------------------- */
  const matches = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return null;
    return new Set(
      tree.nodes
        .filter(
          (n) =>
            n.name.toLowerCase().includes(needle) || n.code.toLowerCase().includes(needle),
        )
        .map((n) => n.id),
    );
  }, [search, tree.nodes]);

  // Revealing matches happens in the search handler, not in an effect
  // reacting to the result: it is a consequence of the user typing, so it
  // belongs on that event.
  const onSearchChange = React.useCallback(
    (value: string) => {
      setSearch(value);
      const needle = value.trim().toLowerCase();
      if (!needle) return;

      const hits = tree.nodes.filter(
        (n) => n.name.toLowerCase().includes(needle) || n.code.toLowerCase().includes(needle),
      );
      if (hits.length === 0) return;

      // Unfold the ancestors of every match, so a hit is never hidden inside a
      // collapsed branch.
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const hit of hits) {
          for (const ancestor of ancestorsOf(tree.nodes, hit.id)) next.delete(ancestor);
        }
        return next;
      });
    },
    [tree.nodes],
  );

  /* -- layout ------------------------------------------------------------ */
  const layout = React.useMemo(
    () => layoutOrgTree(tree.nodes, tree.rootIds, collapsed),
    [tree.nodes, tree.rootIds, collapsed],
  );

  const blockedTargets = React.useMemo(
    () => (draggingId ? descendantsOf(tree.nodes, draggingId) : new Set<string>()),
    [draggingId, tree.nodes],
  );

  const nodes: UnitFlowNode[] = React.useMemo(
    () =>
      layout.nodes.map((positioned) => ({
        id: positioned.node.id,
        type: "unit" as const,
        position: { x: positioned.x, y: positioned.y },
        draggable: mayRestructure,
        data: {
          unit: positioned.node,
          collapsedChildren: positioned.collapsedChildren,
          selected: selectedId === positioned.node.id,
          dimmed: matches !== null && !matches.has(positioned.node.id),
          isMoveSource: draggingId === positioned.node.id,
          isDropTarget: dropTarget === positioned.node.id,
          onToggle: toggle,
        },
      })),
    [layout.nodes, selectedId, matches, draggingId, dropTarget, toggle, mayRestructure],
  );

  const edges: Edge[] = React.useMemo(() => {
    const structural: Edge[] = layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      style: { stroke: "var(--line-strong)", strokeWidth: 1 },
    }));

    if (!showReporting || !detail) return structural;

    // Reporting lines are a DIFFERENT relationship from the structural parent,
    // so they are drawn differently — dashed, accent-coloured, and only for the
    // selected unit, because showing all of them at once is noise.
    const reporting: Edge[] = detail.externalReportingUnitIds
      .filter((id) => nodes.some((n) => n.id === id))
      .map((id) => ({
        id: `report-${detail.unit.id}-${id}`,
        source: id,
        target: detail.unit.id,
        type: "smoothstep",
        animated: true,
        style: { stroke: "var(--accent)", strokeWidth: 1.5, strokeDasharray: "4 3" },
      }));

    return [...structural, ...reporting];
  }, [layout.edges, showReporting, detail, nodes]);

  /* -- selection --------------------------------------------------------- */
  const onNodeClick: NodeMouseHandler = React.useCallback(
    (_event, node) => {
      setSelectedId(node.id);
      setDetail(null);
      void loadDetail(node.id).then(setDetail);
    },
    [loadDetail],
  );

  /* -- drag to restructure ----------------------------------------------- */
  const onNodeDragStart: OnNodeDrag<UnitFlowNode> = React.useCallback((_e, node) => {
    setDraggingId(node.id);
  }, []);

  const onNodeDrag: OnNodeDrag<UnitFlowNode> = React.useCallback(
    (_e, node) => {
      const centre = { x: node.position.x + NODE_WIDTH / 2, y: node.position.y + NODE_HEIGHT / 2 };
      const hit = layout.nodes.find(
        (p) =>
          p.node.id !== node.id &&
          !blockedTargets.has(p.node.id) &&
          centre.x >= p.x &&
          centre.x <= p.x + NODE_WIDTH &&
          centre.y >= p.y &&
          centre.y <= p.y + NODE_HEIGHT,
      );
      setDropTarget(hit?.node.id ?? null);
    },
    [layout.nodes, blockedTargets],
  );

  const onNodeDragStop: OnNodeDrag<UnitFlowNode> = React.useCallback(
    (_e, node) => {
      const target = dropTarget;
      setDraggingId(null);
      setDropTarget(null);
      // Nothing mutates on drop. The drop opens a preview; the operator
      // confirms with a reason, and only then is anything written.
      if (target) setMove({ unitId: node.id, newParentId: target });
    },
    [dropTarget],
  );

  // Centre the first root at a readable zoom rather than fitting the width.
  const initialViewport = React.useMemo(() => {
    const zoom = 0.9;
    const root = layout.nodes.find((n) => n.node.id === tree.rootIds[0]);
    if (!root) return { x: 0, y: 24, zoom };
    return { x: 360 - (root.x + NODE_WIDTH / 2) * zoom, y: 72, zoom };
  }, [layout.nodes, tree.rootIds]);

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () =>
    setCollapsed(new Set(tree.nodes.filter((n) => n.depth >= 1 && n.childIds.length > 0).map((n) => n.id)));

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1">
        <div className="absolute left-0 right-0 top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-line bg-canvas/90 px-3 py-2 backdrop-blur">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-3" aria-hidden />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("searchUnit")}
              aria-label={t("searchUnit")}
              className="h-[var(--control-h-sm)] w-56 pl-7 pr-7"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label={tc("clearFilters")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-3 hover:text-text"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {matches && (
            <span className="tnum text-2xs text-text-3">
              {matches.size} {tc("of")} {tree.nodes.length}
            </span>
          )}

          <Button variant="ghost" size="sm" onClick={expandAll}>
            <ChevronsUpDown /> {t("expandAll")}
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll}>
            <ChevronsDownUp /> {t("collapseAll")}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => flow.fitView({ duration: 200, padding: 0.2, maxZoom: 1 })} aria-label={t("fitView")}>
            <Maximize2 />
          </Button>

          <label className="ml-auto flex items-center gap-1.5 text-2xs text-text-3">
            <Switch checked={showReporting} onCheckedChange={setShowReporting} />
            {t("showReporting")}
          </label>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => {
            setSelectedId(null);
            setDetail(null);
          }}
          defaultViewport={initialViewport}
          minZoom={0.2}
          maxZoom={1.6}
          className="bg-canvas [&_.react-flow__attribution]:!bg-transparent [&_.react-flow__attribution_a]:!text-text-3 [&_.react-flow__attribution]:!text-[9px]"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
          <Controls
            showInteractive={false}
            className="!rounded-[var(--radius-card)] !border !border-line !bg-surface-2 !shadow-[var(--shadow-overlay)] [&_button]:!border-line [&_button]:!bg-surface-2 [&_button]:!fill-text-2 [&_button:hover]:!bg-surface-3"
          />
        </ReactFlow>

        {mayRestructure && (
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface-2/90 px-2.5 py-1 text-2xs text-text-3 backdrop-blur">
            {t("dragHint")}
          </p>
        )}
      </div>

      <UnitPanel detail={detail} selectedId={selectedId} orgSlug={orgSlug} />

      <MoveDialog
        open={move !== null}
        onOpenChange={(open) => !open && setMove(null)}
        unitId={move?.unitId ?? null}
        newParentId={move?.newParentId ?? null}
        orgSlug={orgSlug}
        onApplied={() => {
          setSelectedId(null);
          setDetail(null);
        }}
      />
    </div>
  );
}
