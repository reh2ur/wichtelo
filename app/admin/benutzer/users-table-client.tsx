"use client";

import { useMemo, useState } from "react";
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

const { Provider: UsersTableProvider, useT: useUsersTableT } =
  createIntlContext("adminUsers");

export { UsersTableProvider };

export interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
  groupCount: number;
  lastSignInAt: string | null;
  banned: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function UsersTableClient({ users }: { users: UserRow[] }) {
  const t = useUsersTableT();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: "email",
        header: t("table.email"),
        cell: ({ row }) => (
          <Link
            href={`/admin/benutzer/${row.original.id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {row.original.email}
          </Link>
        ),
      },
      {
        accessorKey: "fullName",
        header: t("table.name"),
        cell: ({ row }) => row.original.fullName ?? "—",
      },
      {
        accessorKey: "createdAt",
        header: t("table.createdAt"),
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        accessorKey: "groupCount",
        header: t("table.groupCount"),
      },
      {
        accessorKey: "lastSignInAt",
        header: t("table.lastSignIn"),
        cell: ({ row }) =>
          row.original.lastSignInAt
            ? formatDate(row.original.lastSignInAt)
            : t("table.never"),
      },
      {
        accessorKey: "banned",
        header: t("table.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.banned ? "destructive" : "default"}>
            {row.original.banned
              ? t("table.statusBanned")
              : t("table.statusActive")}
          </Badge>
        ),
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: users,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
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
