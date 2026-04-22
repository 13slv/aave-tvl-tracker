"use client";

import { useState } from "react";
import type { TvlData, Metric } from "@/lib/tvl";
import TvlTable from "./TvlTable";
import TvlChart from "./TvlChart";

type View = "chains" | "assets";
type Source = "defillama" | "onchain";

type Props = {
  defiLlamaData: TvlData | null;
  onchainData: TvlData | null;
};

const METRIC_LABELS: Record<Metric, string> = {
  net: "Net TVL",
  supplied: "Supplied",
  borrowed: "Borrowed",
};

const METRIC_DESC: Record<Metric, string> = {
  net: "supplied − borrowed (what's actually withdrawable)",
  supplied: "Total deposited (matches Aave UI)",
  borrowed: "Total debt outstanding",
};

export default function TvlDashboard({ defiLlamaData, onchainData }: Props) {
  const [view, setView] = useState<View>("chains");
  const [metric, setMetric] = useState<Metric>("net");
  const [source, setSource] = useState<Source>(
    defiLlamaData ? "defillama" : "onchain"
  );

  const data = source === "defillama" ? defiLlamaData : onchainData;

  if (!data) {
    return (
      <div className="p-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300">
        No data available for {source}. Check that{" "}
        {source === "defillama"
          ? "DefiLlama API is reachable"
          : "public/data/onchain.json exists"}
        .
      </div>
    );
  }

  const rows = view === "chains" ? data.chains : data.assets;
  const totals =
    view === "chains" ? data.chainTotals[metric] : data.assetTotals[metric];
  const nameHeader = view === "chains" ? "Chain" : "Asset";

  const sourceDesc =
    source === "defillama"
      ? "Aggregator TVL (daily snapshots, ~4h lag)"
      : "Direct RPC reads via Alchemy (5 chains, refreshed daily)";

  const Button = ({
    active,
    onClick,
    disabled = false,
    color = "zinc",
    children,
  }: {
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    color?: "zinc" | "blue" | "emerald";
    children: React.ReactNode;
  }) => {
    const activeColors = {
      zinc: "bg-zinc-900 text-white dark:bg-white dark:text-black",
      blue: "bg-blue-600 text-white",
      emerald: "bg-emerald-600 text-white",
    };
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
          active
            ? activeColors[color] + " font-medium"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
        }`}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 p-1 bg-white dark:bg-zinc-900">
            <Button
              active={source === "defillama"}
              onClick={() => setSource("defillama")}
              disabled={!defiLlamaData}
              color="blue"
            >
              DefiLlama
            </Button>
            <Button
              active={source === "onchain"}
              onClick={() => setSource("onchain")}
              disabled={!onchainData}
              color="emerald"
            >
              On-chain
            </Button>
          </div>

          <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 p-1 bg-white dark:bg-zinc-900">
            <Button active={view === "chains"} onClick={() => setView("chains")}>
              By chain
            </Button>
            <Button active={view === "assets"} onClick={() => setView("assets")}>
              By asset
            </Button>
          </div>

          <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 p-1 bg-white dark:bg-zinc-900">
            {(["net", "supplied", "borrowed"] as const).map((m) => (
              <Button
                key={m}
                active={metric === m}
                onClick={() => setMetric(m)}
              >
                {METRIC_LABELS[m]}
              </Button>
            ))}
          </div>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 text-right">
          <div>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {METRIC_LABELS[metric]}
            </span>
            : {METRIC_DESC[metric]}
          </div>
          <div>{sourceDesc}</div>
          <div>Last snapshot: {new Date(data.updatedAt).toUTCString()}</div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
        <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Top-5 {view === "chains" ? "chains" : "assets"} + total (
          {METRIC_LABELS[metric]}), orange line = hack day
        </div>
        <TvlChart
          rows={rows}
          metric={metric}
          dates={data.dates}
          hackDateIndex={data.hackDateIndex}
          totals={totals}
        />
      </div>

      <TvlTable
        rows={rows}
        metric={metric}
        dates={data.dates}
        hackDateIndex={data.hackDateIndex}
        totals={totals}
        nameHeader={nameHeader}
      />
    </div>
  );
}
