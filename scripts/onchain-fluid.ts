import { config } from "dotenv";
config({ path: ".env.local" });

import {
  createPublicClient,
  http,
  parseAbi,
  getAddress,
  type Chain,
  type Hex,
} from "viem";
import { mainnet, arbitrum, base, polygon } from "viem/chains";

const apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  console.error("ALCHEMY_API_KEY not found");
  process.exit(1);
}

// Fluid uses CREATE2 same address everywhere
const LIQUIDITY_RESOLVER = getAddress("0xca13A15de31235A37134B4717021C35A3CF25C60");
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

type ChainCfg = {
  name: string;
  chain: Chain;
  rpcBase: string;
  llamaChain: string;
  nativeSymbol: string;
};

const CHAINS: ChainCfg[] = [
  {
    name: "Ethereum",
    chain: mainnet,
    rpcBase: "eth-mainnet.g.alchemy.com",
    llamaChain: "ethereum",
    nativeSymbol: "ETH",
  },
  {
    name: "Arbitrum",
    chain: arbitrum,
    rpcBase: "arb-mainnet.g.alchemy.com",
    llamaChain: "arbitrum",
    nativeSymbol: "ETH",
  },
  {
    name: "Base",
    chain: base,
    rpcBase: "base-mainnet.g.alchemy.com",
    llamaChain: "base",
    nativeSymbol: "ETH",
  },
  {
    name: "Polygon",
    chain: polygon,
    rpcBase: "polygon-mainnet.g.alchemy.com",
    llamaChain: "polygon",
    nativeSymbol: "POL",
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
const TARGET_TIMESTAMPS = TARGET_DATES.map(
  (d) => Math.floor(new Date(d + "T00:00:00Z").getTime() / 1000)
);

const RESOLVER_ABI = parseAbi([
  "function listedTokens() view returns (address[])",
  "function getOverallTokensData(address[] tokens) view returns ((uint256 borrowRate, uint256 supplyRate, uint256 fee, uint256 lastStoredUtilization, uint256 storageUpdateThreshold, uint256 lastUpdateTimestamp, uint256 supplyExchangePrice, uint256 borrowExchangePrice, uint256 supplyRawInterest, uint256 supplyInterestFree, uint256 borrowRawInterest, uint256 borrowInterestFree, uint256 totalSupply, uint256 totalBorrow, uint256 revenue, uint256 maxUtilization, (uint256 version, (uint256 kink, uint256 rateAtUtilizationZero, uint256 rateAtUtilizationKink, uint256 rateAtUtilizationMax) rateDataV1, (uint256 kink1, uint256 kink2, uint256 rateAtUtilizationZero, uint256 rateAtUtilizationKink1, uint256 rateAtUtilizationKink2, uint256 rateAtUtilizationMax) rateDataV2) rateData)[])",
]);

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
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

type LlamaChartPoint = { timestamp: number; price: number };

async function fetchHistoricalPrices(
  llamaChain: string,
  addresses: Hex[],
  nativeSymbol: string
): Promise<Map<string, Map<string, number>>> {
  const tokens = addresses.map((a) => {
    const lower = a.toLowerCase();
    if (lower === NATIVE_ETH) return `coingecko:${nativeSymbol === "POL" ? "polygon-ecosystem-token" : "ethereum"}`;
    return `${llamaChain}:${lower}`;
  });
  const start = TARGET_TIMESTAMPS[0];
  const url = `https://coins.llama.fi/chart/${tokens.join(",")}?start=${start}&span=${TARGET_DATES.length}&period=1d`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  Llama prices failed: ${res.status}`);
    return new Map();
  }
  const json = (await res.json()) as {
    coins: Record<string, { prices: LlamaChartPoint[] }>;
  };
  const result = new Map<string, Map<string, number>>();
  for (const [key, info] of Object.entries(json.coins)) {
    const m = new Map<string, number>();
    info.prices.forEach((p, i) => {
      if (i < TARGET_DATES.length) m.set(TARGET_DATES[i], p.price);
    });
    // Map back to address. For native: store under NATIVE_ETH
    if (key.startsWith("coingecko:")) {
      result.set(NATIVE_ETH, m);
    } else {
      result.set(key.split(":")[1].toLowerCase(), m);
    }
  }
  return result;
}

async function runChain(cfg: ChainCfg) {
  const t0 = Date.now();
  process.stdout.write(`  ${cfg.name.padEnd(10)} `);

  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(`https://${cfg.rpcBase}/v2/${apiKey}`, {
      retryCount: 3,
      retryDelay: 500,
      batch: { batchSize: 20, wait: 50 },
    }),
  });

  // 1. Listed tokens
  const tokens = (await client.readContract({
    address: LIQUIDITY_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "listedTokens",
  })) as readonly `0x${string}`[];

  if (tokens.length === 0) {
    console.log("✗ no tokens listed");
    return null;
  }

  // 2. Token metadata (symbol + decimals) - skip native ETH
  const erc20Tokens = tokens.filter((t) => t.toLowerCase() !== NATIVE_ETH);
  const meta = await client.multicall({
    contracts: erc20Tokens.flatMap((t) => [
      { address: t, abi: ERC20_ABI, functionName: "symbol" as const },
      { address: t, abi: ERC20_ABI, functionName: "decimals" as const },
    ]),
    allowFailure: true,
  });
  const symbolMap = new Map<string, string>();
  const decimalsMap = new Map<string, number>();
  symbolMap.set(NATIVE_ETH, cfg.nativeSymbol);
  decimalsMap.set(NATIVE_ETH, 18);
  erc20Tokens.forEach((t, i) => {
    const sym = meta[i * 2];
    const dec = meta[i * 2 + 1];
    symbolMap.set(
      t.toLowerCase(),
      sym.status === "success" ? (sym.result as string) : t.slice(0, 8)
    );
    decimalsMap.set(
      t.toLowerCase(),
      dec.status === "success" ? (dec.result as number) : 18
    );
  });

  // 3. Historical prices
  const priceMap = await fetchHistoricalPrices(
    cfg.llamaChain,
    tokens as Hex[],
    cfg.nativeSymbol
  );

  // 4. Block timestamps
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
  const blocks: bigint[] = [];
  for (const ts of TARGET_TIMESTAMPS) blocks.push(await blockAt(ts));

  // 5. Per-block data
  type Snap = Map<string, { supplied: number; borrowed: number; symbol: string }>;
  const snapshots: Snap[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const blockNumber = blocks[i];
    let perBlockTokens: readonly `0x${string}`[];
    try {
      perBlockTokens = (await client.readContract({
        address: LIQUIDITY_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "listedTokens",
        blockNumber,
      })) as readonly `0x${string}`[];
    } catch {
      perBlockTokens = tokens;
    }
    if (perBlockTokens.length === 0) {
      snapshots.push(new Map());
      continue;
    }
    const data = (await client.readContract({
      address: LIQUIDITY_RESOLVER,
      abi: RESOLVER_ABI,
      functionName: "getOverallTokensData",
      args: [perBlockTokens as `0x${string}`[]],
      blockNumber,
    })) as readonly { totalSupply: bigint; totalBorrow: bigint }[];

    const snap: Snap = new Map();
    const SANITY_CAP_USD = 5_000_000_000; // $5B per token cap
    for (let j = 0; j < perBlockTokens.length; j++) {
      const addr = perBlockTokens[j].toLowerCase();
      const symbol = symbolMap.get(addr) ?? addr.slice(0, 8);
      const decimals = BigInt(decimalsMap.get(addr) ?? 18);
      const scale = 10n ** decimals;
      const price = priceMap.get(addr)?.get(TARGET_DATES[i]) ?? 0;
      if (price === 0) continue;
      const supUsd = (Number(data[j].totalSupply) / Number(scale)) * price;
      const borUsd = (Number(data[j].totalBorrow) / Number(scale)) * price;
      // Filter Fluid storage garbage (uninitialized BigMath slots)
      if (supUsd > SANITY_CAP_USD || borUsd > SANITY_CAP_USD) continue;
      snap.set(symbol, { supplied: supUsd, borrowed: borUsd, symbol });
    }
    snapshots.push(snap);
  }

  const totals: number[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    let t = 0;
    for (const v of snapshots[i].values()) t += v.supplied - v.borrowed;
    totals.push(t);
  }

  const elapsed = Date.now() - t0;
  const lastTvl = totals[totals.length - 1];
  console.log(
    `✓ ${elapsed}ms  ${tokens.length} tokens  latest=${fmtUsd(lastTvl)}`
  );

  return { name: cfg.name, totals, snapshots };
}

async function main() {
  const outputPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "public/data/fluid-onchain.json";

  console.log(`Fluid on-chain — ${CHAINS.length} chains × ${TARGET_DATES.length} dates`);
  console.log("Resolver: LiquidityResolver | Prices: Llama coins\n");

  const perChain: { name: string; totals: number[]; snapshots: Map<string, { supplied: number; borrowed: number; symbol: string }>[] }[] = [];
  for (const c of CHAINS) {
    try {
      const r = await runChain(c);
      if (r) perChain.push(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${msg.split("\n")[0].slice(0, 80)}`);
    }
  }

  // Aggregate per asset across chains
  const assetByName = new Map<string, number[]>();
  for (const { snapshots } of perChain) {
    for (let i = 0; i < snapshots.length; i++) {
      for (const [symbol, v] of snapshots[i]) {
        if (!assetByName.has(symbol))
          assetByName.set(symbol, new Array(TARGET_DATES.length).fill(0));
        assetByName.get(symbol)![i] += v.supplied - v.borrowed;
      }
    }
  }

  const assetsAggregated = Array.from(assetByName.entries())
    .map(([symbol, values]) => ({ symbol, values }))
    .sort((a, b) => b.values[HACK_IDX] - a.values[HACK_IDX]);

  if (outputPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });

    const chains = perChain.map(({ name, totals, snapshots }) => ({
      name,
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

    const out = {
      generatedAt: new Date().toISOString(),
      dates: TARGET_DATES,
      hackDateIndex: HACK_IDX,
      chains,
      assetsAggregated,
    };
    writeFileSync(outputPath, JSON.stringify(out, null, 2));
    console.log(`\n📝 ${outputPath}`);
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
