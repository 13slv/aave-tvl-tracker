import type { TvlData, Row, Metric, Protocol } from "./tvl";

type AaveSnapshot = {
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

type MorphoSnapshot = AaveSnapshot;

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

function buildChainsFromSnapshot(
  snap: AaveSnapshot,
  protocol: Protocol,
  N: number
): Row[] {
  return snap.chains.map((c) => {
    const supplied = new Array(N).fill(0);
    const borrowed = new Array(N).fill(0);
    for (const a of c.assets) {
      for (let i = 0; i < N; i++) {
        supplied[i] += a.supplied[i] ?? 0;
        borrowed[i] += a.borrowed[i] ?? 0;
      }
    }
    const net = supplied.map((v, i) => v - borrowed[i]);
    return { name: c.name, protocol, net, supplied, borrowed };
  });
}

function buildAssetsFromSnapshot(
  snap: AaveSnapshot,
  protocol: Protocol,
  N: number
): Row[] {
  const map = new Map<string, { supplied: number[]; borrowed: number[] }>();
  for (const c of snap.chains) {
    for (const a of c.assets) {
      if (!map.has(a.symbol)) {
        map.set(a.symbol, {
          supplied: new Array(N).fill(0),
          borrowed: new Array(N).fill(0),
        });
      }
      const acc = map.get(a.symbol)!;
      for (let i = 0; i < N; i++) {
        acc.supplied[i] += a.supplied[i] ?? 0;
        acc.borrowed[i] += a.borrowed[i] ?? 0;
      }
    }
  }
  return Array.from(map.entries()).map(([name, v]) => ({
    name,
    protocol,
    net: v.supplied.map((s, i) => s - v.borrowed[i]),
    supplied: v.supplied,
    borrowed: v.borrowed,
  }));
}

export async function getOnchainData(): Promise<TvlData> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const aavePath = join(process.cwd(), "public", "data", "onchain.json");
  const morphoPath = join(process.cwd(), "public", "data", "morpho-onchain.json");

  const [aaveRaw, morphoRaw] = await Promise.allSettled([
    readFile(aavePath, "utf-8"),
    readFile(morphoPath, "utf-8"),
  ]);

  if (aaveRaw.status !== "fulfilled") {
    throw new Error("public/data/onchain.json missing");
  }
  const aave = JSON.parse(aaveRaw.value) as AaveSnapshot;
  const morpho =
    morphoRaw.status === "fulfilled"
      ? (JSON.parse(morphoRaw.value) as MorphoSnapshot)
      : null;

  const dates = aave.dates;
  const hackIdx = aave.hackDateIndex;
  const N = dates.length;
  const dateLabels = dates.map(formatLabel);

  const chains: Row[] = [
    ...buildChainsFromSnapshot(aave, "aave", N),
    ...(morpho ? buildChainsFromSnapshot(morpho, "morpho", N) : []),
  ].sort((a, b) => b.supplied[hackIdx] - a.supplied[hackIdx]);

  const assets: Row[] = [
    ...buildAssetsFromSnapshot(aave, "aave", N),
    ...(morpho ? buildAssetsFromSnapshot(morpho, "morpho", N) : []),
  ]
    .filter((r) => r.supplied[hackIdx] >= 10_000_000)
    .sort((a, b) => b.supplied[hackIdx] - a.supplied[hackIdx]);

  return {
    updatedAt: aave.generatedAt,
    dates: dateLabels,
    hackDateIndex: hackIdx,
    hackDateIso: dates[hackIdx],
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
