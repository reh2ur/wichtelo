"use client";

import { flexRender, type Header } from "@tanstack/react-table";

import { TableHead } from "@/components/ui/table";

const ARIA_SORT = {
  asc: "ascending",
  desc: "descending",
} as const;

/** Sortable column header: real button (keyboard operable) + aria-sort on the th. */
export function SortableTableHead<TData>({
  header,
}: {
  header: Header<TData, unknown>;
}) {
  const sorted = header.column.getIsSorted();
  const content = flexRender(
    header.column.columnDef.header,
    header.getContext(),
  );

  if (!header.column.getCanSort()) {
    return <TableHead>{content}</TableHead>;
  }

  return (
    <TableHead aria-sort={sorted ? ARIA_SORT[sorted] : "none"}>
      <button
        type="button"
        onClick={header.column.getToggleSortingHandler()}
        className="focus-visible:ring-ring/50 -mx-1 inline-flex min-h-11 items-center gap-1 rounded px-1 font-medium select-none focus-visible:ring-3 focus-visible:outline-none md:min-h-8"
      >
        {content}
        <span aria-hidden="true">
          {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : ""}
        </span>
      </button>
    </TableHead>
  );
}
