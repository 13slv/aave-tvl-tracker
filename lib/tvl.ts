const DEFILLAMA_URL = "https://api.llama.fi/protocol/aave-v3";

const HACK_DATE_ISO = "2026-04-18";
const HACK_TS = Math.floor(Date.UTC(2026, 3, 18) / 1000);
const DAYS_BEFORE_HACK = 3;
const SECONDS_PER_DAY = 86400;

export type Row = {
  name: string;
  values: (number | null)[];
  baseline: number | null;
  latest: number | null;
  deltaPct: number | null;
};

export type TvlData = {
  updatedAt: string;
  dates: string[];
  hackDateIndex: number;
  hackDateIso: string;
  chains: Row[];
  assets: Row[];
  chainTotals: number[];
  assetTotals: number[];
  chainTotalDeltaPct: number;
  assetTotalDeltaPct: number;
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

function deltaPct(baseline: number | null, latest: number | null): number | null {
  if (!baseline || baseline === 0 || latest === null) return null;
  return ((latest - baseline) / baseline) * 100;
}

function findSnapshot<T extends { date: number }>(
  series: T[],
  targetTs: number,
  toleranceSec = 12 * 3600
): T | null {
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
    (ts) => Math.floor(ts / SECONDS_PER_DAY) === Math.floor(HACK_TS / SECONDS_PER_DAY)
  );

  const chainRows: Row[] = [];
  const assetTotals: Record<string, number[]> = {};

  for (const [rawKey, chainData] of Object.entries(data.chainTvls)) {
    if (rawKey.endsWith("-borrowed") || rawKey === "borrowed") continue;

    const tvlValues: (number | null)[] = targetTs.map((ts) => {
      const snap = findSnapshot(chainData.tvl ?? [], ts);
      return snap ? snap.totalLiquidityUSD : null;
    });
    const baseline = hackDateIndex >= 0 ? tvlValues[hackDateIndex] : null;
    const latest = tvlValues[tvlValues.length - 1];
    if (baseline !== null && baseline > 0) {
      chainRows.push({
        name: rawKey === "xDai" ? "Gnosis" : rawKey,
        values: tvlValues,
        baseline,
        latest,
        deltaPct: deltaPct(baseline, latest),
      });
    }

    const tokensSeries = chainData.tokensInUsd ?? [];
    for (let i = 0; i < targetTs.length; i++) {
      const snap = findSnapshot(tokensSeries, targetTs[i]);
      if (!snap) continue;
      for (const [asset, usd] of Object.entries(snap.tokens)) {
        if (!assetTotals[asset]) {
          assetTotals[asset] = new Array(targetTs.length).fill(0);
        }
        assetTotals[asset][i] += usd;
      }
    }
  }

  chainRows.sort((a, b) => (b.baseline ?? 0) - (a.baseline ?? 0));

  const assetRows: Row[] = Object.entries(assetTotals)
    .map(([name, values]) => {
      const baseline = hackDateIndex >= 0 ? values[hackDateIndex] : null;
      const latest = values[values.length - 1];
      return {
        name,
        values,
        baseline,
        latest,
        deltaPct: deltaPct(baseline, latest),
      };
    })
    .filter((r) => (r.baseline ?? 0) >= 10_000_000)
    .sort((a, b) => (b.baseline ?? 0) - (a.baseline ?? 0));

  const chainTotals = targetTs.map((_, i) =>
    chainRows.reduce((sum, r) => sum + (r.values[i] ?? 0), 0)
  );
  const assetTotals_ = targetTs.map((_, i) =>
    assetRows.reduce((sum, r) => sum + (r.values[i] ?? 0), 0)
  );

  return {
    updatedAt: new Date(latestTs * 1000).toISOString(),
    dates: dateLabels,
    hackDateIndex,
    hackDateIso: HACK_DATE_ISO,
    chains: chainRows,
    assets: assetRows,
    chainTotals,
    assetTotals: assetTotals_,
    chainTotalDeltaPct:
      deltaPct(chainTotals[hackDateIndex] ?? null, chainTotals[chainTotals.length - 1]) ?? 0,
    assetTotalDeltaPct:
      deltaPct(assetTotals_[hackDateIndex] ?? null, assetTotals_[assetTotals_.length - 1]) ?? 0,
  };
}
