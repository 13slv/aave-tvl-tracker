import type { Row } from "@/lib/tvl";

function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function deltaClass(v: number | null): string {
  if (v === null) return "text-zinc-500";
  if (v <= -50) return "text-red-600 font-semibold";
  if (v <= -20) return "text-red-500";
  if (v < 0) return "text-orange-500";
  if (v > 0) return "text-emerald-600";
  return "text-zinc-500";
}

type Props = {
  rows: Row[];
  dates: string[];
  hackDateIndex: number;
  totals: number[];
  totalDeltaPct: number;
  nameHeader: string;
};

export default function TvlTable({
  rows,
  dates,
  hackDateIndex,
  totals,
  totalDeltaPct,
  nameHeader,
}: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900 text-left">
          <tr>
            <th className="px-3 py-2 font-semibold sticky left-0 bg-zinc-50 dark:bg-zinc-900">
              {nameHeader}
            </th>
            {dates.map((d, i) => (
              <th
                key={d}
                className={`px-3 py-2 font-semibold text-right whitespace-nowrap ${
                  i === hackDateIndex
                    ? "bg-amber-100 dark:bg-amber-900/30"
                    : ""
                }`}
              >
                {d}
                {i === hackDateIndex && (
                  <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">
                    hack
                  </span>
                )}
              </th>
            ))}
            <th className="px-3 py-2 font-semibold text-right">Δ vs hack</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
            >
              <td className="px-3 py-2 font-medium sticky left-0 bg-white dark:bg-black">
                {row.name}
              </td>
              {row.values.map((v, i) => (
                <td
                  key={i}
                  className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
                    i === hackDateIndex
                      ? "bg-amber-50 dark:bg-amber-900/10 font-semibold"
                      : ""
                  }`}
                >
                  {fmtUsd(v)}
                </td>
              ))}
              <td
                className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${deltaClass(
                  row.deltaPct
                )}`}
              >
                {fmtPct(row.deltaPct)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 font-semibold">
            <td className="px-3 py-2 sticky left-0 bg-zinc-50 dark:bg-zinc-900">
              TOTAL
            </td>
            {totals.map((t, i) => (
              <td
                key={i}
                className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
                  i === hackDateIndex
                    ? "bg-amber-100 dark:bg-amber-900/30"
                    : ""
                }`}
              >
                {fmtUsd(t)}
              </td>
            ))}
            <td
              className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${deltaClass(
                totalDeltaPct
              )}`}
            >
              {fmtPct(totalDeltaPct)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
