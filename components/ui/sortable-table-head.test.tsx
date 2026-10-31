// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { SortableTableHead } from "./sortable-table-head";

const columns: ColumnDef<{ a: string }>[] = [
  { accessorKey: "a", header: "Name" },
];

function Harness() {
  const table = useReactTable({
    data: [{ a: "x" }],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <table>
      <thead>
        <tr>
          {table.getHeaderGroups()[0].headers.map((h) => (
            <SortableTableHead key={h.id} header={h} />
          ))}
        </tr>
      </thead>
    </table>
  );
}

describe("SortableTableHead", () => {
  it("renders a button and toggles aria-sort", () => {
    render(<Harness />);
    const th = screen.getByRole("columnheader");
    expect(th.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(th.getAttribute("aria-sort")).toBe("descending");
  });
});
