import type { TvlData, Row, Metric } from "./tvl";

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

function formatLabel(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

function sumAcross(rows: Row[], metric: Metric, len: number): number[] {
  const out = new Array(len).fill(0);
  for (const r of rows)
    for (let i = 0; i < len; i++) out[i] += r[metric][i] ?? 0;
  return out;
}

export function onchainToTvlData(snapshot: OnchainSnapshot): TvlData {
  const hackIdx = snapshot.hackDateIndex;
  const N = snapshot.dates.length;
  const dateLabels = snapshot.dates.map(formatLabel);

  const chains: Row[] = snapshot.chains.map((c) => {
    const supplied = new Array(N).fill(0);
    const borrowed = new Array(N).fill(0);
    for (const a of c.assets) {
      for (let i = 0; i < N; i++) {
        supplied[i] += a.supplied[i] ?? 0;
        borrowed[i] += a.borrowed[i] ?? 0;
      }
    }
    const net = supplied.map((v, i) => v - borrowed[i]);
    return { name: c.name, net, supplied, borrowed };
  });
  chains.sort((a, b) => b.supplied[hackIdx] - a.supplied[hackIdx]);

  const assetMap = new Map<string, { supplied: number[]; borrowed: number[] }>();
  for (const c of snapshot.chains) {
    for (const a of c.assets) {
      if (!assetMap.has(a.symbol)) {
        assetMap.set(a.symbol, {
          supplied: new Array(N).fill(0),
          borrowed: new Array(N).fill(0),
        });
      }
      const acc = assetMap.get(a.symbol)!;
      for (let i = 0; i < N; i++) {
        acc.supplied[i] += a.supplied[i] ?? 0;
        acc.borrowed[i] += a.borrowed[i] ?? 0;
      }
    }
  }

  const assets: Row[] = Array.from(assetMap.entries())
    .map(([name, v]) => {
      const net = v.supplied.map((s, i) => s - v.borrowed[i]);
      return { name, net, supplied: v.supplied, borrowed: v.borrowed };
    })
    .filter((r) => r.supplied[hackIdx] >= 10_000_000)
    .sort((a, b) => b.supplied[hackIdx] - a.supplied[hackIdx]);

  return {
    updatedAt: snapshot.generatedAt,
    dates: dateLabels,
    hackDateIndex: hackIdx,
    hackDateIso: snapshot.dates[hackIdx],
    chains,
    assets,
    chainTotals: {
      net: sumAcross(chains, "net", N),
      supplied: sumAcross(chains, "supplied", N),
      borrowed: sumAcross(chains, "borrowed", N),
    },
    assetTotals: {
      net: sumAcross(assets, "net", N),
      supplied: sumAcross(assets, "supplied", N),
      borrowed: sumAcross(assets, "borrowed", N),
    },
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
