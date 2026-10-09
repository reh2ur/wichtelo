"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createIntlContext } from "@/lib/create-intl-context";
import type { AdminAction, AdminTargetType } from "@/lib/admin/audit";

const { Provider: AuditTableProvider, useT: useAuditTableT } =
  createIntlContext("adminAuditLog");

export { AuditTableProvider };

export interface AuditRow {
  id: string;
  actorEmail: string;
  action: AdminAction;
  targetType: AdminTargetType;
  targetId: string;
  targetHref: Route | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const ACTIONS: AdminAction[] = [
  "ban_user",
  "unban_user",
  "delete_user",
  "delete_group",
  "reopen_group",
];

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

function formatRelative(iso: string): string {
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });
  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return rtf.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return rtf.format(Math.round(diffSeconds), "second");
}

function TimestampCell({ iso }: { iso: string }) {
  return <span title={formatAbsolute(iso)}>{formatRelative(iso)}</span>;
}

function MetadataCell({
  metadata,
}: {
  metadata: Record<string, unknown> | null;
}) {
  const t = useAuditTableT();
  if (!metadata)
    return (
      <span className="text-muted-foreground">{t("table.metadataNone")}</span>
    );
  return (
    <details>
      <summary className="text-primary cursor-pointer text-xs underline-offset-4 hover:underline">
        {t("table.metadataShow")}
      </summary>
      <pre className="bg-muted mt-2 max-w-xs overflow-x-auto rounded p-2 text-xs">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </details>
  );
}

export function AuditTableClient({ entries }: { entries: AuditRow[] }) {
  const t = useAuditTableT();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [actionFilter, setActionFilter] = useState<string>("all");

  const filteredEntries = useMemo(
    () =>
      actionFilter === "all"
        ? entries
        : entries.filter((e) => e.action === actionFilter),
    [entries, actionFilter],
  );

  const columns = useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: t("table.timestamp"),
        cell: ({ row }) => <TimestampCell iso={row.original.createdAt} />,
      },
      {
        accessorKey: "actorEmail",
        header: t("table.actor"),
      },
      {
        accessorKey: "action",
        header: t("table.action"),
        cell: ({ row }) => t(`actions.${row.original.action}`),
      },
      {
        accessorKey: "targetType",
        header: t("table.targetType"),
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.targetType === "user"
              ? t("table.targetTypeUser")
              : t("table.targetTypeGroup")}
          </Badge>
        ),
      },
      {
        accessorKey: "targetId",
        header: t("table.targetId"),
        cell: ({ row }) =>
          row.original.targetHref ? (
            <Link
              href={row.original.targetHref}
              className="text-primary font-mono text-xs underline-offset-4 hover:underline"
            >
              {row.original.targetId}
            </Link>
          ) : (
            <span className="font-mono text-xs">{row.original.targetId}</span>
          ),
      },
      {
        accessorKey: "metadata",
        header: t("table.metadata"),
        cell: ({ row }) => <MetadataCell metadata={row.original.metadata} />,
        enableSorting: false,
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: filteredEntries,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="action-filter" className="text-sm">
          {t("table.actionFilterLabel")}
        </label>
        <select
          id="action-filter"
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            table.setPageIndex(0);
          }}
          className="border-input bg-background focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm shadow-xs transition-colors focus-visible:ring-3 focus-visible:outline-none"
        >
          <option value="all">{t("table.actionFilterAll")}</option>
          {ACTIONS.map((action) => (
            <option key={action} value={action}>
              {t(`actions.${action}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="border-border overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={
                      header.column.getCanSort()
                        ? "cursor-pointer select-none"
                        : undefined
                    }
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {{ asc: " ↑", desc: " ↓" }[
                      header.column.getIsSorted() as string
                    ] ?? ""}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground text-center"
                >
                  {t("table.empty")}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {t("table.pageInfo", {
            current: table.getState().pagination.pageIndex + 1,
            total: Math.max(table.getPageCount(), 1),
          })}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {t("table.previous")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("table.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
