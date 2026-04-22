import type { TvlData, Row } from "./tvl";

type OnchainSnapshot = {
  generatedAt: string;
  dates: string[];
  hackDateIndex: number;
  chains: {
    name: string;
    totals: number[];
    assets: { symbol: string; supplied: number[]; borrowed: number[] }[];
  }[];
  assetsAggregated: { symbol: string; values: number[] }[];
};

function deltaPct(baseline: number, latest: number): number | null {
  if (!baseline) return null;
  return ((latest - baseline) / Math.abs(baseline)) * 100;
}

function formatLabel(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

export function onchainToTvlData(snapshot: OnchainSnapshot): TvlData {
  const hackIdx = snapshot.hackDateIndex;
  const dateLabels = snapshot.dates.map(formatLabel);

  const chains: Row[] = snapshot.chains.map((c) => {
    const values = c.totals;
    const baseline = values[hackIdx];
    const latest = values[values.length - 1];
    return {
      name: c.name,
      values,
      baseline,
      latest,
      deltaPct: deltaPct(baseline, latest),
    };
  });
  chains.sort((a, b) => (b.baseline ?? 0) - (a.baseline ?? 0));

  const assets: Row[] = snapshot.assetsAggregated
    .map((a) => {
      const values = a.values;
      const baseline = values[hackIdx];
      const latest = values[values.length - 1];
      return {
        name: a.symbol,
        values,
        baseline,
        latest,
        deltaPct: deltaPct(baseline, latest),
      };
    })
    .filter((r) => Math.abs(r.baseline ?? 0) >= 10_000_000)
    .sort((a, b) => (b.baseline ?? 0) - (a.baseline ?? 0));

  const chainTotals = snapshot.dates.map((_, i) =>
    chains.reduce((s, r) => s + (r.values[i] ?? 0), 0)
  );
  const assetTotals = snapshot.dates.map((_, i) =>
    assets.reduce((s, r) => s + (r.values[i] ?? 0), 0)
  );

  return {
    updatedAt: snapshot.generatedAt,
    dates: dateLabels,
    hackDateIndex: hackIdx,
    hackDateIso: snapshot.dates[hackIdx],
    chains,
    assets,
    chainTotals,
    assetTotals,
    chainTotalDeltaPct:
      deltaPct(chainTotals[hackIdx], chainTotals[chainTotals.length - 1]) ?? 0,
    assetTotalDeltaPct:
      deltaPct(assetTotals[hackIdx], assetTotals[assetTotals.length - 1]) ?? 0,
  };
}

export async function getOnchainData(): Promise<TvlData> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const path = join(process.cwd(), "public", "data", "onchain.json");
  const raw = await readFile(path, "utf-8");
  const snapshot = JSON.parse(raw) as OnchainSnapshot;
  return onchainToTvlData(snapshot);
}
