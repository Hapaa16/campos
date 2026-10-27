"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgTreeNode } from "@/server/services/org-units";

export type UnitNodeData = {
  unit: OrgTreeNode;
  collapsedChildren: number;
  selected: boolean;
  dimmed: boolean;
  isMoveSource: boolean;
  isDropTarget: boolean;
  onToggle: (id: string) => void;
};

export type UnitFlowNode = Node<UnitNodeData, "unit">;

/** Depth is signalled by type label and weight, not by a rainbow of colours. */
const TYPE_STYLE: Record<string, string> = {
  COMPANY: "text-accent",
  DIVISION: "text-text-2",
  DEPARTMENT: "text-text-3",
  SECTION: "text-text-3",
  TEAM: "text-text-3",
};

export const UnitNode = memo(function UnitNode({ data }: NodeProps<UnitFlowNode>) {
  const { unit, collapsedChildren, selected, dimmed, isMoveSource, isDropTarget } = data;
  const hasChildren = unit.childIds.length > 0;

  const target = unit.headcountTarget;
  // Understaffing is a state, so it gets colour. Being fully staffed does not.
  const short = target !== null && unit.directHeadcount < target;

  return (
    <div
      className={cn(
        "ui-transition group relative flex h-[62px] w-[208px] flex-col justify-center rounded-[var(--radius-card)] border bg-surface px-2.5",
        selected
          ? "border-accent ring-2 ring-accent-soft"
          : isDropTarget
            ? "border-ok ring-2 ring-ok-soft"
            : "border-line hover:border-line-strong",
        isMoveSource && "opacity-50",
        dimmed && "opacity-25",
        unit.status === "archived" && "border-dashed opacity-60",
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-1 !border-0 !bg-line-strong" />

      <p className={cn("truncate text-2xs font-semibold uppercase tracking-wider", TYPE_STYLE[unit.unitTypeCode] ?? "text-text-3")}>
        {unit.unitTypeName}
      </p>
      <p className="truncate text-sm font-medium leading-tight text-text" title={unit.name}>
        {unit.name}
      </p>

      <div className="mt-0.5 flex items-center gap-2 text-2xs text-text-3">
        <span className="truncate font-mono">{unit.code}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Users className="size-2.5" aria-hidden />
          <span className={cn("tnum", short && "text-warn")}>
            {unit.directHeadcount}
            {target !== null && <span className="text-text-3">/{target}</span>}
          </span>
          {unit.totalHeadcount !== unit.directHeadcount && (
            <span className="tnum text-text-3">(Σ{unit.totalHeadcount})</span>
          )}
        </span>
      </div>

      {hasChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle(unit.id);
          }}
          aria-label={collapsedChildren > 0 ? "Дэлгэх" : "Хураах"}
          aria-expanded={collapsedChildren === 0}
          className={cn(
            "ui-transition absolute -bottom-2.5 left-1/2 z-10 flex h-5 -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface-2 px-1.5",
            "text-2xs text-text-3 hover:border-line-strong hover:text-text",
          )}
        >
          {collapsedChildren > 0 ? (
            <>
              <ChevronRight className="size-2.5" />
              <span className="tnum">{collapsedChildren}</span>
            </>
          ) : (
            <ChevronDown className="size-2.5" />
          )}
        </button>
      )}

      <Handle type="source" position={Position.Bottom} className="!size-1 !border-0 !bg-line-strong" />
    </div>
  );
});
