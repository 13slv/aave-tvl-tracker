"use client";

import { useEffect, useMemo, useState } from "react";
import type { TvlData, Metric, Protocol } from "@/lib/tvl";
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

const PROTOCOL_LABELS: Record<Protocol, string> = {
  aave: "Aave V3",
  morpho: "Morpho",
  spark: "Spark",
  fluid: "Fluid",
};

function computeTotals(
  rows: { net: number[]; supplied: number[]; borrowed: number[] }[],
  metric: Metric,
  N: number
): number[] {
  const out = new Array(N).fill(0);
  for (const r of rows)
    for (let i = 0; i < N; i++) out[i] += r[metric][i] ?? 0;
  return out;
}

export default function TvlDashboard({ defiLlamaData, onchainData }: Props) {
  const [view, setView] = useState<View>("chains");
  const [metric, setMetric] = useState<Metric>("net");
  const [protocol, setProtocol] = useState<Protocol>("aave");
  const [source, setSource] = useState<Source>(
    defiLlamaData ? "defillama" : "onchain"
  );

  const data = source === "defillama" ? defiLlamaData : onchainData;

  const morphoAvailable = useMemo(() => {
    if (!data) return false;
    return data.assets.some((r) => r.protocol === "morpho");
  }, [data]);

  const sparkAvailable = useMemo(() => {
    if (!data) return false;
    return data.assets.some((r) => r.protocol === "spark");
  }, [data]);

  const fluidAvailable = useMemo(() => {
    if (!data) return false;
    return data.assets.some((r) => r.protocol === "fluid");
  }, [data]);

  // If user picked unavailable protocol, fall back to Aave
  useEffect(() => {
    if (protocol === "morpho" && !morphoAvailable) setProtocol("aave");
    if (protocol === "spark" && !sparkAvailable) setProtocol("aave");
    if (protocol === "fluid" && !fluidAvailable) setProtocol("aave");
  }, [morphoAvailable, sparkAvailable, fluidAvailable, protocol]);

  if (!data) {
    return (
      <div className="p-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300">
        No data available for {source}.
      </div>
    );
  }

  const allRows = view === "chains" ? data.chains : data.assets;
  const filteredRows = allRows.filter((r) => r.protocol === protocol);
  const totals = computeTotals(filteredRows, metric, data.dates.length);
  const nameHeader = view === "chains" ? "Chain" : "Asset";

  const sourceDesc =
    source === "defillama"
      ? "Aggregator TVL (daily snapshots, ~4h lag)"
      : "Direct RPC reads via Alchemy (refreshed daily)";

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
    color?: "zinc" | "blue" | "emerald" | "purple" | "cyan" | "amber" | "pink";
    children: React.ReactNode;
  }) => {
    const activeColors = {
      zinc: "bg-zinc-900 text-white dark:bg-white dark:text-black",
      blue: "bg-blue-600 text-white",
      emerald: "bg-emerald-600 text-white",
      purple: "bg-purple-600 text-white",
      cyan: "bg-cyan-600 text-white",
      amber: "bg-amber-600 text-white",
      pink: "bg-pink-600 text-white",
    };
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
          active
            ? activeColors[color] + " font-medium"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
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
            <Button
              active={protocol === "aave"}
              onClick={() => setProtocol("aave")}
              color="purple"
            >
              {PROTOCOL_LABELS.aave}
            </Button>
            <Button
              active={protocol === "morpho"}
              onClick={() => setProtocol("morpho")}
              disabled={!morphoAvailable}
              color="cyan"
            >
              {PROTOCOL_LABELS.morpho}
            </Button>
            <Button
              active={protocol === "spark"}
              onClick={() => setProtocol("spark")}
              disabled={!sparkAvailable}
              color="amber"
            >
              {PROTOCOL_LABELS.spark}
            </Button>
            <Button
              active={protocol === "fluid"}
              onClick={() => setProtocol("fluid")}
              disabled={!fluidAvailable}
              color="pink"
            >
              {PROTOCOL_LABELS.fluid}
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
              {PROTOCOL_LABELS[protocol]} · {METRIC_LABELS[metric]}
            </span>
          </div>
          <div>{METRIC_DESC[metric]}</div>
          <div>{sourceDesc}</div>
          <div>Last snapshot: {new Date(data.updatedAt).toUTCString()}</div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">
          No {PROTOCOL_LABELS[protocol]} data in {source === "defillama" ? "DefiLlama" : "on-chain"} source.
          {protocol !== "aave" && source === "defillama" && (
            <> Switch to On-chain to see {PROTOCOL_LABELS[protocol]}.</>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
            <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              Top-5 {view === "chains" ? "chains" : "assets"} + total (
              {METRIC_LABELS[metric]}), orange line = hack day
            </div>
            <TvlChart
              rows={filteredRows}
              metric={metric}
              dates={data.dates}
              hackDateIndex={data.hackDateIndex}
              totals={totals}
              showProtocol={false}
            />
          </div>

          <TvlTable
            rows={filteredRows}
            metric={metric}
            dates={data.dates}
            hackDateIndex={data.hackDateIndex}
            totals={totals}
            nameHeader={nameHeader}
            showProtocol={false}
          />
        </>
      )}
    </div>
  );
}
