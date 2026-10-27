"use client";

import { useTranslations } from "next-intl";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuTrigger } from "@/components/ui/menu";

export interface ColumnToggle {
  id: string;
  label: string;
  /** Columns the table would be meaningless without. */
  locked?: boolean;
}

export function ColumnMenu({
  columns,
  visibility,
  onChange,
}: {
  columns: ColumnToggle[];
  visibility: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}) {
  const t = useTranslations("common");
  const isVisible = (id: string) => visibility[id] !== false;

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("details")}>
          <Columns3 />
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-48">
        <MenuLabel>{t("details")}</MenuLabel>
        {columns.map((column) => (
          <MenuCheckboxItem
            key={column.id}
            checked={isVisible(column.id)}
            disabled={column.locked}
            onCheckedChange={(checked) => onChange({ ...visibility, [column.id]: checked })}
            className="relative"
          >
            {column.label}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
