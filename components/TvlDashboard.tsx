"use client";

import { useState } from "react";
import type { TvlData } from "@/lib/tvl";
import TvlTable from "./TvlTable";
import TvlChart from "./TvlChart";

type View = "chains" | "assets";

export default function TvlDashboard({ data }: { data: TvlData }) {
  const [view, setView] = useState<View>("chains");

  const rows = view === "chains" ? data.chains : data.assets;
  const totals = view === "chains" ? data.chainTotals : data.assetTotals;
  const totalDelta =
    view === "chains" ? data.chainTotalDeltaPct : data.assetTotalDeltaPct;
  const nameHeader = view === "chains" ? "Chain" : "Asset";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 p-1 bg-white dark:bg-zinc-900">
          <button
            onClick={() => setView("chains")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              view === "chains"
                ? "bg-zinc-900 text-white dark:bg-white dark:text-black font-medium"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            By chain
          </button>
          <button
            onClick={() => setView("assets")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              view === "assets"
                ? "bg-zinc-900 text-white dark:bg-white dark:text-black font-medium"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            By asset
          </button>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Last snapshot: {new Date(data.updatedAt).toUTCString()}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
        <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Top-5 {view === "chains" ? "chains" : "assets"} + total, orange line = hack day
        </div>
        <TvlChart
          rows={rows}
          dates={data.dates}
          hackDateIndex={data.hackDateIndex}
          totals={totals}
        />
      </div>

      <TvlTable
        rows={rows}
        dates={data.dates}
        hackDateIndex={data.hackDateIndex}
        totals={totals}
        totalDeltaPct={totalDelta}
        nameHeader={nameHeader}
      />
    </div>
  );
}
