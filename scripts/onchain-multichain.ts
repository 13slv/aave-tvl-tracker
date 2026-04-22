import { config } from "dotenv";
config({ path: ".env.local" });

import {
  createPublicClient,
  http,
  parseAbi,
  getAddress,
  type Chain,
} from "viem";
import { mainnet, arbitrum, base, mantle, optimism } from "viem/chains";
import {
  AaveV3Ethereum,
  AaveV3Arbitrum,
  AaveV3Base,
  AaveV3Mantle,
  AaveV3Optimism,
} from "@bgd-labs/aave-address-book";

const apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  console.error("ALCHEMY_API_KEY not found");
  process.exit(1);
}

type ChainCfg = {
  name: string;
  chain: Chain;
  rpcBase: string;
  dataProvider: `0x${string}`;
  oracle: `0x${string}`;
};

const CHAINS: ChainCfg[] = [
  {
    name: "Ethereum",
    chain: mainnet,
    rpcBase: "eth-mainnet.g.alchemy.com",
    dataProvider: getAddress(AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER),
    oracle: getAddress(AaveV3Ethereum.ORACLE),
  },
  {
    name: "Arbitrum",
    chain: arbitrum,
    rpcBase: "arb-mainnet.g.alchemy.com",
    dataProvider: getAddress(AaveV3Arbitrum.AAVE_PROTOCOL_DATA_PROVIDER),
    oracle: getAddress(AaveV3Arbitrum.ORACLE),
  },
  {
    name: "Base",
    chain: base,
    rpcBase: "base-mainnet.g.alchemy.com",
    dataProvider: getAddress(AaveV3Base.AAVE_PROTOCOL_DATA_PROVIDER),
    oracle: getAddress(AaveV3Base.ORACLE),
  },
  {
    name: "Mantle",
    chain: mantle,
    rpcBase: "mantle-mainnet.g.alchemy.com",
    dataProvider: getAddress(AaveV3Mantle.AAVE_PROTOCOL_DATA_PROVIDER),
    oracle: getAddress(AaveV3Mantle.ORACLE),
  },
  {
    name: "Optimism",
    chain: optimism,
    rpcBase: "opt-mainnet.g.alchemy.com",
    dataProvider: getAddress(AaveV3Optimism.AAVE_PROTOCOL_DATA_PROVIDER),
    oracle: getAddress(AaveV3Optimism.ORACLE),
  },
];

const TARGET_DATES = [
  "2026-04-15",
  "2026-04-16",
  "2026-04-17",
  "2026-04-18",
  "2026-04-19",
  "2026-04-20",
  "2026-04-21",
  "2026-04-22",
];
const HACK_IDX = TARGET_DATES.indexOf("2026-04-18");

const DATA_PROVIDER_ABI = parseAbi([
  "function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])",
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);
const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)"]);
const ORACLE_ABI = parseAbi([
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
]);
const PRICE_ABI = parseAbi([
  "function getAssetPrice(address asset) view returns (uint256)",
]);

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  if (abs === 0) return "—";
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

async function runChain(cfg: ChainCfg) {
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(`https://${cfg.rpcBase}/v2/${apiKey}`, {
      retryCount: 3,
      retryDelay: 500,
      batch: { batchSize: 20, wait: 50 },
    }),
  });

  const reservesList = (await client.readContract({
    address: cfg.dataProvider,
    abi: DATA_PROVIDER_ABI,
    functionName: "getAllReservesTokens",
  })) as readonly { symbol: string; tokenAddress: `0x${string}` }[];
  const assets = reservesList.map((r) => getAddress(r.tokenAddress));

  const decimalsArr = await client.multicall({
    contracts: assets.map((a) => ({
      address: a,
      abi: ERC20_ABI,
      functionName: "decimals" as const,
    })),
    allowFailure: true,
  });
  const decimalsMap = new Map<`0x${string}`, number>();
  assets.forEach((a, i) =>
    decimalsMap.set(a, (decimalsArr[i].result as number | undefined) ?? 18)
  );

  const baseUnit = (await client.readContract({
    address: cfg.oracle,
    abi: ORACLE_ABI,
    functionName: "BASE_CURRENCY_UNIT",
  })) as bigint;

  // binary search blocks for timestamps
  async function blockAt(targetTs: number): Promise<bigint> {
    const latest = await client.getBlock();
    if (Number(latest.timestamp) <= targetTs) return latest.number;
    let lo = 0n;
    let hi = latest.number;
    while (lo < hi - 1n) {
      const mid = (lo + hi) / 2n;
      const b = await client.getBlock({ blockNumber: mid });
      if (Number(b.timestamp) < targetTs) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  const timestamps = TARGET_DATES.map(
    (d) => Math.floor(new Date(d + "T00:00:00Z").getTime() / 1000)
  );
  const blocks: bigint[] = [];
  for (const ts of timestamps) blocks.push(await blockAt(ts));

  const snapshots: Map<
    string,
    { supplied: number; borrowed: number; symbol: string }
  >[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const blockNumber = blocks[i];
    const reservesAtBlock = (await client.readContract({
      address: cfg.dataProvider,
      abi: DATA_PROVIDER_ABI,
      functionName: "getAllReservesTokens",
      blockNumber,
    })) as readonly { symbol: string; tokenAddress: `0x${string}` }[];

    const assetsAtBlock = reservesAtBlock.map((r) =>
      getAddress(r.tokenAddress)
    );

    const calls = [
      ...assetsAtBlock.map((a) => ({
        address: cfg.dataProvider,
        abi: DATA_PROVIDER_ABI,
        functionName: "getReserveData" as const,
        args: [a] as const,
      })),
      ...assetsAtBlock.map((a) => ({
        address: cfg.oracle,
        abi: PRICE_ABI,
        functionName: "getAssetPrice" as const,
        args: [a] as const,
      })),
    ];

    const results = await client.multicall({
      contracts: calls,
      blockNumber,
      allowFailure: true,
    });

    const snap = new Map<
      string,
      { supplied: number; borrowed: number; symbol: string }
    >();
    for (let j = 0; j < assetsAtBlock.length; j++) {
      const rdRes = results[j];
      const prRes = results[assetsAtBlock.length + j];
      if (rdRes.status !== "success" || prRes.status !== "success") continue;
      const rd = rdRes.result as readonly bigint[];
      const price = prRes.result as bigint;
      if (price === 0n) continue;
      const totalAToken = rd[2];
      const totalStableDebt = rd[3];
      const totalVariableDebt = rd[4];
      const totalDebt = totalStableDebt + totalVariableDebt;
      const dec = BigInt(decimalsMap.get(assetsAtBlock[j]) ?? 18);
      const scale = 10n ** dec;
      const supUsd =
        Number((totalAToken * price) / scale) / Number(baseUnit);
      const borUsd = Number((totalDebt * price) / scale) / Number(baseUnit);
      snap.set(reservesAtBlock[j].symbol, {
        supplied: supUsd,
        borrowed: borUsd,
        symbol: reservesAtBlock[j].symbol,
      });
    }
    snapshots.push(snap);
  }

  const totals: number[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    let t = 0;
    for (const v of snapshots[i].values()) t += v.supplied - v.borrowed;
    totals.push(t);
  }

  return { cfg, snapshots, totals };
}

async function main() {
  const outputPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : null;

  console.log(`Querying ${CHAINS.length} chains × ${TARGET_DATES.length} dates...\n`);

  const perChain: Awaited<ReturnType<typeof runChain>>[] = [];
  for (const c of CHAINS) {
    const t0 = Date.now();
    process.stdout.write(`  ${c.name.padEnd(10)} `);
    try {
      const r = await runChain(c);
      perChain.push(r);
      const lastTvl = r.totals[r.totals.length - 1];
      console.log(
        `✓ ${Date.now() - t0}ms  latest=${fmtUsd(lastTvl)}`
      );
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? (e.message || String(e)) : String(e);
      console.log(`✗ ${msg.split("\n")[0].slice(0, 80)}`);
    }
  }

  // Aggregated per-asset across chains
  const assetByDate: Map<string, number[]> = new Map();
  for (const { snapshots } of perChain) {
    for (let i = 0; i < snapshots.length; i++) {
      for (const [symbol, v] of snapshots[i]) {
        if (!assetByDate.has(symbol)) {
          assetByDate.set(symbol, new Array(TARGET_DATES.length).fill(0));
        }
        assetByDate.get(symbol)![i] += v.supplied - v.borrowed;
      }
    }
  }

  const assetRows = Array.from(assetByDate.entries())
    .map(([symbol, values]) => ({ symbol, values }))
    .filter((r) => Math.abs(r.values[HACK_IDX]) >= 10_000_000)
    .sort((a, b) => b.values[HACK_IDX] - a.values[HACK_IDX]);

  // Chain totals matrix
  console.log("\n=== Net TVL by chain (USD) ===\n");
  const labels = TARGET_DATES.map((d) => d.slice(5));
  const col = (s: string, w: number, right = false) =>
    right ? s.padStart(w) : s.padEnd(w);
  let header = col("Chain", 12);
  for (const l of labels)
    header += col(l + (l === "04-18" ? "*" : ""), 11, true);
  header += col("Δ hack", 10, true);
  console.log(header);
  console.log("-".repeat(header.length));

  const dateTotals = new Array(TARGET_DATES.length).fill(0);
  for (const { cfg, totals } of perChain) {
    let line = col(cfg.name, 12);
    for (const t of totals) line += col(fmtUsd(t), 11, true);
    const base = totals[HACK_IDX];
    const latest = totals[totals.length - 1];
    const pct = base ? ((latest - base) / Math.abs(base)) * 100 : null;
    line += col(fmtPct(pct), 10, true);
    console.log(line);
    for (let i = 0; i < dateTotals.length; i++) dateTotals[i] += totals[i];
  }
  console.log("-".repeat(header.length));
  let totalLine = col("TOTAL", 12);
  for (const t of dateTotals) totalLine += col(fmtUsd(t), 11, true);
  const bT = dateTotals[HACK_IDX];
  const lT = dateTotals[dateTotals.length - 1];
  totalLine += col(
    fmtPct(bT ? ((lT - bT) / Math.abs(bT)) * 100 : null),
    10,
    true
  );
  console.log(totalLine);

  console.log(
    `\n=== Top assets aggregated across ${perChain.length} chains (Net TVL, USD ≥ $10M @ hack) ===\n`
  );
  let ah = col("Asset", 14);
  for (const l of labels)
    ah += col(l + (l === "04-18" ? "*" : ""), 11, true);
  ah += col("Δ hack", 10, true);
  console.log(ah);
  console.log("-".repeat(ah.length));
  for (const r of assetRows.slice(0, 25)) {
    let line = col(r.symbol, 14);
    for (const v of r.values) line += col(fmtUsd(v), 11, true);
    const base = r.values[HACK_IDX];
    const latest = r.values[r.values.length - 1];
    const pct = base ? ((latest - base) / Math.abs(base)) * 100 : null;
    line += col(fmtPct(pct), 10, true);
    console.log(line);
  }

  if (outputPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });

    const chains = perChain.map(({ cfg, totals, snapshots }) => ({
      name: cfg.name,
      totals,
      assets: Array.from(
        new Set(
          snapshots.flatMap((s) => Array.from(s.keys()))
        )
      )
        .map((symbol) => ({
          symbol,
          supplied: snapshots.map((s) => s.get(symbol)?.supplied ?? 0),
          borrowed: snapshots.map((s) => s.get(symbol)?.borrowed ?? 0),
        }))
        .sort(
          (a, b) =>
            b.supplied[HACK_IDX] -
            b.borrowed[HACK_IDX] -
            (a.supplied[HACK_IDX] - a.borrowed[HACK_IDX])
        ),
    }));

    const allAssets = Array.from(assetByDate.entries())
      .map(([symbol, values]) => ({ symbol, values }))
      .sort((a, b) => b.values[HACK_IDX] - a.values[HACK_IDX]);

    const out = {
      generatedAt: new Date().toISOString(),
      dates: TARGET_DATES,
      hackDateIndex: HACK_IDX,
      chains,
      assetsAggregated: allAssets,
    };
    writeFileSync(outputPath, JSON.stringify(out, null, 2));
    console.log(`\n📝 Wrote snapshot → ${outputPath}`);
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
