const DEFILLAMA_URL = "https://api.llama.fi/protocol/aave-v3";

const HACK_DATE_ISO = "2026-04-18";
const HACK_TS = Math.floor(Date.UTC(2026, 3, 18) / 1000);
const DAYS_BEFORE_HACK = 3;
const SECONDS_PER_DAY = 86400;

export type Metric = "net" | "supplied" | "borrowed";
export type Protocol = "aave" | "morpho" | "spark" | "fluid";

export type Row = {
  name: string;
  protocol: Protocol;
  net: number[];
  supplied: number[];
  borrowed: number[];
};

export type TvlData = {
  updatedAt: string;
  dates: string[];
  hackDateIndex: number;
  hackDateIso: string;
  chains: Row[];
  assets: Row[];
  chainTotals: Record<Metric, number[]>;
  assetTotals: Record<Metric, number[]>;
};

type TokenMap = Record<string, number>;
type TokensSeries = { date: number; tokens: TokenMap }[];
type TvlSeries = { date: number; totalLiquidityUSD: number }[];

type ProtocolData = {
  chainTvls: Record<
    string,
    { tvl?: TvlSeries; tokensInUsd?: TokensSeries }
  >;
};

function formatDateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return `${month} ${day}`;
}

function findSnapshot<T extends { date: number }>(
  series: T[] | undefined,
  targetTs: number,
  toleranceSec = 12 * 3600
): T | null {
  if (!series) return null;
  let best: T | null = null;
  let bestDist = Infinity;
  for (const p of series) {
    const dist = Math.abs(p.date - targetTs);
    if (dist < bestDist && dist <= toleranceSec) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

function buildTargetTimestamps(latestTs: number): number[] {
  const todayMidnight = Math.floor(latestTs / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  const start = HACK_TS - DAYS_BEFORE_HACK * SECONDS_PER_DAY;
  const targets: number[] = [];
  for (let ts = start; ts <= todayMidnight; ts += SECONDS_PER_DAY) {
    targets.push(ts);
  }
  if (latestTs - todayMidnight > 3600) {
    targets.push(latestTs);
  }
  return targets;
}

function sumAcross(rows: Row[], metric: Metric, len: number): number[] {
  const out = new Array(len).fill(0);
  for (const r of rows)
    for (let i = 0; i < len; i++) out[i] += r[metric][i] ?? 0;
  return out;
}

export async function getTvlData(): Promise<TvlData> {
  const res = await fetch(DEFILLAMA_URL, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`DefiLlama fetch failed: ${res.status}`);
  const data = (await res.json()) as ProtocolData;

  const allTvlDates = new Set<number>();
  for (const key of Object.keys(data.chainTvls)) {
    if (key.endsWith("-borrowed") || key === "borrowed") continue;
    const series = data.chainTvls[key].tvl;
    if (series) for (const p of series) allTvlDates.add(p.date);
  }
  const sortedDates = [...allTvlDates].sort((a, b) => a - b);
  const latestTs = sortedDates[sortedDates.length - 1];

  const targetTs = buildTargetTimestamps(latestTs);
  const dateLabels = targetTs.map(formatDateLabel);
  const hackDateIndex = targetTs.findIndex(
    (ts) =>
      Math.floor(ts / SECONDS_PER_DAY) === Math.floor(HACK_TS / SECONDS_PER_DAY)
  );
  const N = targetTs.length;

  const chainRows: Row[] = [];
  const assetNet: Record<string, number[]> = {};
  const assetBor: Record<string, number[]> = {};

  for (const [rawKey, chainData] of Object.entries(data.chainTvls)) {
    if (rawKey.endsWith("-borrowed") || rawKey === "borrowed") continue;

    const borrowedChain = data.chainTvls[`${rawKey}-borrowed`];

    const net = targetTs.map((ts) => {
      const snap = findSnapshot(chainData.tvl, ts);
      return snap ? snap.totalLiquidityUSD : 0;
    });
    const borrowed = targetTs.map((ts) => {
      const snap = findSnapshot(borrowedChain?.tvl, ts);
      return snap ? snap.totalLiquidityUSD : 0;
    });
    const supplied = net.map((v, i) => v + borrowed[i]);

    if (supplied[hackDateIndex] > 0) {
      chainRows.push({
        name: rawKey === "xDai" ? "Gnosis" : rawKey,
        protocol: "aave",
        net,
        supplied,
        borrowed,
      });
    }

    for (let i = 0; i < N; i++) {
      const netSnap = findSnapshot(chainData.tokensInUsd, targetTs[i]);
      const borSnap = findSnapshot(borrowedChain?.tokensInUsd, targetTs[i]);
      if (netSnap) {
        for (const [asset, usd] of Object.entries(netSnap.tokens)) {
          if (!assetNet[asset]) assetNet[asset] = new Array(N).fill(0);
          assetNet[asset][i] += usd;
        }
      }
      if (borSnap) {
        for (const [asset, usd] of Object.entries(borSnap.tokens)) {
          if (!assetBor[asset]) assetBor[asset] = new Array(N).fill(0);
          assetBor[asset][i] += usd;
        }
      }
    }
  }

  chainRows.sort(
    (a, b) => b.supplied[hackDateIndex] - a.supplied[hackDateIndex]
  );

  const allAssets = new Set([...Object.keys(assetNet), ...Object.keys(assetBor)]);
  const assetRows: Row[] = [...allAssets]
    .map((name) => {
      const net = assetNet[name] ?? new Array(N).fill(0);
      const borrowed = assetBor[name] ?? new Array(N).fill(0);
      const supplied = net.map((v, i) => v + borrowed[i]);
      return { name, protocol: "aave" as const, net, supplied, borrowed };
    })
    .filter((r) => (r.supplied[hackDateIndex] ?? 0) >= 10_000_000)
    .sort((a, b) => b.supplied[hackDateIndex] - a.supplied[hackDateIndex]);

  return {
    updatedAt: new Date(latestTs * 1000).toISOString(),
    dates: dateLabels,
    hackDateIndex,
    hackDateIso: HACK_DATE_ISO,
    chains: chainRows,
    assets: assetRows,
    chainTotals: {
      net: sumAcross(chainRows, "net", N),
      supplied: sumAcross(chainRows, "supplied", N),
      borrowed: sumAcross(chainRows, "borrowed", N),
    },
    assetTotals: {
      net: sumAcross(assetRows, "net", N),
      supplied: sumAcross(assetRows, "supplied", N),
      borrowed: sumAcross(assetRows, "borrowed", N),
    },
  };
}
