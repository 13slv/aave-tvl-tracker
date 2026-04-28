import { config } from "dotenv";
config({ path: ".env.local" });

import {
  createPublicClient,
  http,
  parseAbi,
  getAddress,
  type Chain,
} from "viem";
import { mainnet, gnosis } from "viem/chains";

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
    dataProvider: getAddress("0xFc21d6d146E6086B8359705C8b28512a983db0cb"),
    oracle: getAddress("0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9"),
  },
  {
    name: "Gnosis",
    chain: gnosis,
    rpcBase: "gnosis-mainnet.g.alchemy.com",
    dataProvider: getAddress("0x2a002054A06546bB5a264D57A81347e23Af91D18"),
    oracle: getAddress("0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9"),
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
      const supUsd = Number((totalAToken * price) / scale) / Number(baseUnit);
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
    : "public/data/spark-onchain.json";

  console.log(`SparkLend on-chain — ${CHAINS.length} chains × ${TARGET_DATES.length} dates\n`);

  const perChain: Awaited<ReturnType<typeof runChain>>[] = [];
  for (const c of CHAINS) {
    const t0 = Date.now();
    process.stdout.write(`  ${c.name.padEnd(10)} `);
    try {
      const r = await runChain(c);
      perChain.push(r);
      const lastTvl = r.totals[r.totals.length - 1];
      console.log(`✓ ${Date.now() - t0}ms  latest=${fmtUsd(lastTvl)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e.message || String(e)) : String(e);
      console.log(`✗ ${msg.split("\n")[0].slice(0, 80)}`);
    }
  }

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

  if (outputPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });

    const chains = perChain.map(({ cfg, totals, snapshots }) => ({
      name: cfg.name,
      totals,
      assets: Array.from(
        new Set(snapshots.flatMap((s) => Array.from(s.keys())))
      )
        .map((symbol) => ({
          symbol,
          supplied: snapshots.map((s) => s.get(symbol)?.supplied ?? 0),
          borrowed: snapshots.map((s) => s.get(symbol)?.borrowed ?? 0),
        }))
        .sort(
          (a, b) =>
            b.supplied[HACK_IDX] - b.borrowed[HACK_IDX] -
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
    console.log(`\n📝 ${outputPath}`);
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
