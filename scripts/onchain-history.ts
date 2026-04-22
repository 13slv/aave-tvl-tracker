import { config } from "dotenv";
config({ path: ".env.local" });

import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { mainnet } from "viem/chains";
import { AaveV3Ethereum } from "@bgd-labs/aave-address-book";

const apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  console.error("ALCHEMY_API_KEY not found in .env.local");
  process.exit(1);
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`, {
    retryCount: 3,
    retryDelay: 500,
    batch: { batchSize: 20, wait: 50 },
  }),
});

const DATA_PROVIDER_ABI = parseAbi([
  "function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])",
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
]);

const ORACLE_ABI = parseAbi([
  "function getAssetsPrices(address[] assets) view returns (uint256[])",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
]);

const DATA_PROVIDER = getAddress(AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER);
const ORACLE = getAddress(AaveV3Ethereum.ORACLE);

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
const HACK_DATE = "2026-04-18";

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
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

async function blockAtTimestamp(targetTs: number): Promise<bigint> {
  const latest = await client.getBlock();
  if (Number(latest.timestamp) <= targetTs) return latest.number;

  let lo = 0n;
  let hi = latest.number;
  while (lo < hi - 1n) {
    const mid = (lo + hi) / 2n;
    const b = await client.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < targetTs) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

const SINGLE_PRICE_ABI = parseAbi([
  "function getAssetPrice(address asset) view returns (uint256)",
]);

async function snapshotAtBlock(
  blockNumber: bigint,
  decimalsMap: Map<`0x${string}`, number>,
  baseUnit: bigint
) {
  const reservesAtBlock = (await client.readContract({
    address: DATA_PROVIDER,
    abi: DATA_PROVIDER_ABI,
    functionName: "getAllReservesTokens",
    blockNumber,
  })) as readonly { symbol: string; tokenAddress: `0x${string}` }[];

  const assets = reservesAtBlock.map((r) => getAddress(r.tokenAddress));

  const calls = [
    ...assets.map((a) => ({
      address: DATA_PROVIDER,
      abi: DATA_PROVIDER_ABI,
      functionName: "getReserveData" as const,
      args: [a] as const,
    })),
    ...assets.map((a) => ({
      address: ORACLE,
      abi: SINGLE_PRICE_ABI,
      functionName: "getAssetPrice" as const,
      args: [a] as const,
    })),
  ];

  const results = await client.multicall({
    contracts: calls,
    blockNumber,
    allowFailure: true,
  });

  const perAsset = new Map<
    `0x${string}`,
    { supplied: number; borrowed: number; symbol: string }
  >();
  for (let i = 0; i < assets.length; i++) {
    const rdResult = results[i];
    const priceResult = results[assets.length + i];
    if (rdResult.status !== "success" || priceResult.status !== "success") {
      perAsset.set(assets[i], {
        supplied: 0,
        borrowed: 0,
        symbol: reservesAtBlock[i].symbol,
      });
      continue;
    }
    const rd = rdResult.result as readonly bigint[];
    const totalAToken = rd[2];
    const totalStableDebt = rd[3];
    const totalVariableDebt = rd[4];
    const totalDebt = totalStableDebt + totalVariableDebt;
    const price = priceResult.result as bigint;
    const dec = BigInt(decimalsMap.get(assets[i]) ?? 18);
    const scale = 10n ** dec;

    const supUsd = Number((totalAToken * price) / scale) / Number(baseUnit);
    const borUsd = Number((totalDebt * price) / scale) / Number(baseUnit);
    perAsset.set(assets[i], {
      supplied: supUsd,
      borrowed: borUsd,
      symbol: reservesAtBlock[i].symbol,
    });
  }
  return perAsset;
}

async function main() {
  console.log("1. Bootstrapping: loading reserve list + decimals from current block...");
  const reservesList = (await client.readContract({
    address: DATA_PROVIDER,
    abi: DATA_PROVIDER_ABI,
    functionName: "getAllReservesTokens",
  })) as readonly { symbol: string; tokenAddress: `0x${string}` }[];

  const assets = reservesList.map((r) => getAddress(r.tokenAddress));
  const symbolMap = new Map<`0x${string}`, string>();
  for (const r of reservesList)
    symbolMap.set(getAddress(r.tokenAddress), r.symbol);

  const decimalsArr = await Promise.all(
    assets.map((a) =>
      client.readContract({
        address: a,
        abi: ERC20_ABI,
        functionName: "decimals",
      }) as Promise<number>
    )
  );
  const decimalsMap = new Map<`0x${string}`, number>();
  assets.forEach((a, i) => decimalsMap.set(a, decimalsArr[i]));

  const baseUnit = (await client.readContract({
    address: ORACLE,
    abi: ORACLE_ABI,
    functionName: "BASE_CURRENCY_UNIT",
  })) as bigint;

  console.log(`   Found ${assets.length} reserves, base unit = ${baseUnit}\n`);

  console.log("2. Binary-searching blocks for each target date...");
  const targetTimestamps = TARGET_DATES.map(
    (d) => Math.floor(new Date(d + "T00:00:00Z").getTime() / 1000)
  );
  const blocks: bigint[] = [];
  for (let i = 0; i < targetTimestamps.length; i++) {
    const b = await blockAtTimestamp(targetTimestamps[i]);
    blocks.push(b);
    console.log(`   ${TARGET_DATES[i]} → block ${b}`);
  }

  console.log("\n3. Querying reserve data at each block...");
  const snapshots: Map<
    `0x${string}`,
    { supplied: number; borrowed: number; symbol: string }
  >[] = [];
  for (let i = 0; i < blocks.length; i++) {
    process.stdout.write(`   ${TARGET_DATES[i]}...`);
    const t0 = Date.now();
    const snap = await snapshotAtBlock(blocks[i], decimalsMap, baseUnit);
    snapshots.push(snap);
    console.log(` ${Date.now() - t0}ms (${snap.size} reserves)`);
  }

  const hackIdx = TARGET_DATES.indexOf(HACK_DATE);

  type Row = {
    symbol: string;
    address: `0x${string}`;
    supplied: number[];
    borrowed: number[];
    net: number[];
  };
  const rows: Row[] = assets.map((a) => {
    const supplied = snapshots.map((s) => s.get(a)?.supplied ?? 0);
    const borrowed = snapshots.map((s) => s.get(a)?.borrowed ?? 0);
    const net = supplied.map((s, i) => s - borrowed[i]);
    return { symbol: symbolMap.get(a) ?? "?", address: a, supplied, borrowed, net };
  });

  rows.sort((a, b) => b.supplied[hackIdx] - a.supplied[hackIdx]);

  const labels = TARGET_DATES.map((d) => d.slice(5));
  const col = (s: string, w: number, right = false) =>
    right ? s.padStart(w) : s.padEnd(w);

  console.log("\n=== Aave V3 Ethereum — Net TVL (supplied − borrowed), USD ===\n");
  let header = col("Asset", 12);
  for (const l of labels) header += col(l + (l === "04-18" ? "*" : ""), 11, true);
  header += col("Δ hack", 10, true);
  console.log(header);
  console.log("-".repeat(header.length));

  const totals = new Array(TARGET_DATES.length).fill(0);
  for (const r of rows) {
    if (r.supplied[hackIdx] < 10_000_000) {
      for (let i = 0; i < totals.length; i++) totals[i] += r.net[i];
      continue;
    }
    let line = col(r.symbol, 12);
    for (const v of r.net) line += col(fmtUsd(v), 11, true);
    const baseline = r.net[hackIdx];
    const latest = r.net[r.net.length - 1];
    const pct = baseline ? ((latest - baseline) / Math.abs(baseline)) * 100 : null;
    line += col(fmtPct(pct), 10, true);
    console.log(line);
    for (let i = 0; i < totals.length; i++) totals[i] += r.net[i];
  }

  console.log("-".repeat(header.length));
  let totalLine = col("TOTAL", 12);
  for (const t of totals) totalLine += col(fmtUsd(t), 11, true);
  const baseTot = totals[hackIdx];
  const latestTot = totals[totals.length - 1];
  totalLine += col(
    fmtPct(baseTot ? ((latestTot - baseTot) / Math.abs(baseTot)) * 100 : null),
    10,
    true
  );
  console.log(totalLine);
  console.log("\n* = последний снимок ДО эксплойта (18 апреля 00:00 UTC)");

  const rsEth = rows.find((r) => r.symbol.toLowerCase().includes("rseth"));
  if (rsEth) {
    console.log(
      `\n🎯 rsETH trajectory (supplied USD, not net):\n   ` +
        TARGET_DATES.map(
          (d, i) => `${d.slice(5)}=${fmtUsd(rsEth.supplied[i])}`
        ).join("  ")
    );
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
