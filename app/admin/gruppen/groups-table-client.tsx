"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  type ColumnDef,
  type FilterFn,
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

const { Provider: GroupsTableProvider, useT: useGroupsTableT } =
  createIntlContext("adminGroups");

export { GroupsTableProvider };

export interface GroupRow {
  id: string;
  name: string;
  slug: string;
  state: "open" | "drawn";
  memberCount: number;
  createdByName: string | null;
  createdByUserId: string;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function SlugCell({ slug }: { slug: string }) {
  const t = useGroupsTableT();
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(slug);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="font-mono text-xs underline-offset-4 hover:underline"
      title={t("table.copySlug")}
    >
      {copied ? t("table.copied") : slug}
    </button>
  );
}

export function GroupsTableClient({ groups }: { groups: GroupRow[] }) {
  const t = useGroupsTableT();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const stateFilterFn: FilterFn<GroupRow> = useMemo(
    () => (row, _columnId, filterValue: string) => {
      const needle = filterValue.toLowerCase();
      const stateLabel =
        row.original.state === "drawn"
          ? t("table.stateDrawn")
          : t("table.stateOpen");
      return (
        row.original.name.toLowerCase().includes(needle) ||
        row.original.slug.toLowerCase().includes(needle) ||
        stateLabel.toLowerCase().includes(needle)
      );
    },
    [t],
  );

  const columns = useMemo<ColumnDef<GroupRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("table.name"),
        cell: ({ row }) => (
          <Link
            href={`/admin/gruppen/${row.original.id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "slug",
        header: t("table.slug"),
        cell: ({ row }) => <SlugCell slug={row.original.slug} />,
      },
      {
        accessorKey: "state",
        header: t("table.state"),
        cell: ({ row }) => (
          <Badge
            variant={row.original.state === "drawn" ? "default" : "outline"}
          >
            {row.original.state === "drawn"
              ? t("table.stateDrawn")
              : t("table.stateOpen")}
          </Badge>
        ),
      },
      {
        accessorKey: "memberCount",
        header: t("table.memberCount"),
      },
      {
        accessorKey: "createdByName",
        header: t("table.createdBy"),
        cell: ({ row }) => (
          <Link
            href={`/admin/benutzer/${row.original.createdByUserId}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {row.original.createdByName ?? "—"}
          </Link>
        ),
      },
      {
        accessorKey: "createdAt",
        header: t("table.createdAt"),
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: groups,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: stateFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  return (
    <div>
      <input
        value={globalFilter}
        onChange={(e) => table.setGlobalFilter(e.target.value)}
        placeholder={t("table.filterPlaceholder")}
        className="border-input bg-background focus-visible:ring-ring/50 mb-3 h-9 w-full max-w-sm rounded-lg border px-3 text-sm shadow-xs transition-colors focus-visible:ring-3 focus-visible:outline-none"
      />
      <div className="border-border overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="cursor-pointer select-none"
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
