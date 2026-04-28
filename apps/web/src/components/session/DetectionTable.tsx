import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowData,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  useDetectionsStore,
  type HistoryItem,
} from "@/stores/detections-store";

/* eslint-disable @typescript-eslint/no-unused-vars */
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
    headerClassName?: string;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

const column = createColumnHelper<HistoryItem>();

const formatTime = (date: Date) =>
  date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const confidenceTone = (confidence: number) => {
  if (confidence >= 0.9) return "bg-emerald-500";
  if (confidence >= 0.75) return "bg-amber-500";
  return "bg-red-500";
};

const detectionColumns = [
  column.accessor("text", {
    header: "Sign",
    cell: (info) => (
      <span className="font-medium text-foreground">{info.getValue()}</span>
    ),
  }),
  column.accessor("confidence", {
    header: "Confidence",
    cell: (info) => {
      const value = info.getValue();
      return (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", confidenceTone(value))}
          />
          <span className="tabular-nums text-muted-foreground">
            {(value * 100).toFixed(1)}%
          </span>
        </div>
      );
    },
  }),
  column.accessor("processingTimeMs", {
    header: "Latency",
    cell: (info) => (
      <span className="tabular-nums text-muted-foreground">
        {info.getValue().toFixed(0)} ms
      </span>
    ),
  }),
  column.accessor("timestamp", {
    header: "Time",
    sortingFn: "datetime",
    cell: (info) => (
      <span className="tabular-nums text-muted-foreground">
        {formatTime(info.getValue())}
      </span>
    ),
    meta: {
      className: "text-right",
      headerClassName: "text-right",
    },
  }),
];

export function DetectionTable() {
  const history = useDetectionsStore((s) => s.history);

  const table = useReactTable({
    data: history,
    columns: detectionColumns,
    initialState: {
      sorting: [{ id: "timestamp", desc: true }],
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Table variant="card">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const sort = header.column.getIsSorted();
              const canSort = header.column.getCanSort();

              return (
                <TableHead
                  key={header.id}
                  className={cn(header.column.columnDef.meta?.headerClassName)}
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <button
                      aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                      className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                      onClick={header.column.getToggleSortingHandler()}
                      type="button"
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {sort === "asc" ? (
                        <ArrowUpIcon className="size-3 opacity-80" />
                      ) : sort === "desc" ? (
                        <ArrowDownIcon className="size-3 opacity-80" />
                      ) : (
                        <ChevronsUpDownIcon className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cn(cell.column.columnDef.meta?.className)}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
