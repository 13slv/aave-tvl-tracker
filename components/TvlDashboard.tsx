"use client";

import { useState } from "react";
import type { TvlData } from "@/lib/tvl";
import TvlTable from "./TvlTable";
import TvlChart from "./TvlChart";

type View = "chains" | "assets";
type Source = "defillama" | "onchain";

type Props = {
  defiLlamaData: TvlData | null;
  onchainData: TvlData | null;
};

export default function TvlDashboard({ defiLlamaData, onchainData }: Props) {
  const [view, setView] = useState<View>("chains");
  const [source, setSource] = useState<Source>(
    defiLlamaData ? "defillama" : "onchain"
  );

  const data =
    source === "defillama" ? defiLlamaData : onchainData;

  if (!data) {
    return (
      <div className="p-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300">
        No data available for {source}. Check that{" "}
        {source === "defillama"
          ? "DefiLlama API is reachable"
          : "public/data/onchain.json exists"}.
      </div>
    );
  }

  const rows = view === "chains" ? data.chains : data.assets;
  const totals = view === "chains" ? data.chainTotals : data.assetTotals;
  const totalDelta =
    view === "chains" ? data.chainTotalDeltaPct : data.assetTotalDeltaPct;
  const nameHeader = view === "chains" ? "Chain" : "Asset";

  const sourceDesc =
    source === "defillama"
      ? "Aggregator TVL (daily snapshots, ~4h lag)"
      : "Direct RPC reads via Alchemy (5 chains, refreshed daily)";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 p-1 bg-white dark:bg-zinc-900">
            <button
              onClick={() => setSource("defillama")}
              disabled={!defiLlamaData}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                source === "defillama"
                  ? "bg-blue-600 text-white font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              }`}
            >
              DefiLlama
            </button>
            <button
              onClick={() => setSource("onchain")}
              disabled={!onchainData}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                source === "onchain"
                  ? "bg-emerald-600 text-white font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              }`}
            >
              On-chain
            </button>
          </div>

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
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 text-right">
          <div>{sourceDesc}</div>
          <div>Last snapshot: {new Date(data.updatedAt).toUTCString()}</div>
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
