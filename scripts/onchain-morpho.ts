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
import { mainnet, base } from "viem/chains";

const apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  console.error("ALCHEMY_API_KEY not found");
  process.exit(1);
}

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const;

const MORPHO_ABI = parseAbi([
  "function market(bytes32 id) view returns ((uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee))",
  "function idToMarketParams(bytes32 id) view returns ((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv))",
]);

type ChainCfg = {
  name: string;
  chain: Chain;
  rpcBase: string;
  graphqlChainId: number;
  llamaChain: string;
};

const CHAINS: ChainCfg[] = [
  {
    name: "Ethereum",
    chain: mainnet,
    rpcBase: "eth-mainnet.g.alchemy.com",
    graphqlChainId: 1,
    llamaChain: "ethereum",
  },
  {
    name: "Base",
    chain: base,
    rpcBase: "base-mainnet.g.alchemy.com",
    graphqlChainId: 8453,
    llamaChain: "base",
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

type MorphoMarket = {
  uniqueKey: Hex;
  loanAsset: { symbol: string; decimals: number; address: Hex };
  collateralAsset: { symbol: string };
  state: { supplyAssetsUsd: number };
};

async function fetchTopMarkets(chainId: number, n = 40): Promise<MorphoMarket[]> {
  const query = `{
    markets(where: {chainId_in: [${chainId}]}, first: ${n}, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
      items {
        uniqueKey
        loanAsset { symbol decimals address }
        collateralAsset { symbol }
        state { supplyAssetsUsd }
      }
    }
  }`;
  const res = await fetch("https://blue-api.morpho.org/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as {
    data: { markets: { items: MorphoMarket[] } };
  };
  return json.data.markets.items.filter(
    (m) => m.state && m.state.supplyAssetsUsd > 1_000_000
  );
}

type LlamaChartPoint = { timestamp: number; price: number };

async function fetchHistoricalPrices(
  llamaChain: string,
  addresses: Hex[]
): Promise<Map<string, Map<string, number>>> {
  const keys = addresses
    .map((a) => `${llamaChain}:${a.toLowerCase()}`)
    .join(",");
  const start = TARGET_TIMESTAMPS[0];
  const url = `https://coins.llama.fi/chart/${keys}?start=${start}&span=${TARGET_DATES.length}&period=1d`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`Llama prices failed: ${res.status}`);
    return new Map();
  }
  const json = (await res.json()) as {
    coins: Record<string, { prices: LlamaChartPoint[] }>;
  };
  const result = new Map<string, Map<string, number>>();
  for (const [key, info] of Object.entries(json.coins)) {
    const addr = key.split(":")[1].toLowerCase();
    const m = new Map<string, number>();
    info.prices.forEach((p, i) => {
      if (i < TARGET_DATES.length) m.set(TARGET_DATES[i], p.price);
    });
    result.set(addr, m);
  }
  return result;
}

async function blockAtTimestamp(
  client: ReturnType<typeof createPublicClient>,
  targetTs: number
): Promise<bigint> {
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

async function runChain(cfg: ChainCfg) {
  process.stdout.write(`  ${cfg.name.padEnd(10)} `);
  const t0 = Date.now();

  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(`https://${cfg.rpcBase}/v2/${apiKey}`, {
      retryCount: 3,
      retryDelay: 500,
      batch: { batchSize: 20, wait: 50 },
    }),
  });

  const markets = await fetchTopMarkets(cfg.graphqlChainId);
  const uniqueLoanTokens = Array.from(
    new Set(markets.map((m) => m.loanAsset.address.toLowerCase() as Hex))
  );

  const priceMap = await fetchHistoricalPrices(cfg.llamaChain, uniqueLoanTokens);

  const blocks: bigint[] = [];
  for (const ts of TARGET_TIMESTAMPS) blocks.push(await blockAtTimestamp(client, ts));

  // For each block, multicall market(id) for all markets
  type SnapPerMarket = Map<
    Hex,
    { totalSupplyAssets: bigint; totalBorrowAssets: bigint }
  >;
  const snapshots: SnapPerMarket[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const blockNumber = blocks[i];
    const calls = markets.map((m) => ({
      address: getAddress(MORPHO_BLUE),
      abi: MORPHO_ABI,
      functionName: "market" as const,
      args: [m.uniqueKey] as const,
    }));
    const results = await client.multicall({
      contracts: calls,
      blockNumber,
      allowFailure: true,
    });
    const snap: SnapPerMarket = new Map();
    for (let j = 0; j < markets.length; j++) {
      const r = results[j];
      if (r.status !== "success") continue;
      const m = r.result as {
        totalSupplyAssets: bigint;
        totalSupplyShares: bigint;
        totalBorrowAssets: bigint;
        totalBorrowShares: bigint;
        lastUpdate: bigint;
        fee: bigint;
      };
      snap.set(markets[j].uniqueKey, {
        totalSupplyAssets: m.totalSupplyAssets,
        totalBorrowAssets: m.totalBorrowAssets,
      });
    }
    snapshots.push(snap);
  }

  // Aggregate per loan asset
  const perAsset = new Map<
    string,
    { symbol: string; supplied: number[]; borrowed: number[] }
  >();
  for (const market of markets) {
    const addr = market.loanAsset.address.toLowerCase();
    const symbol = market.loanAsset.symbol;
    const decimals = BigInt(market.loanAsset.decimals);
    const scale = 10n ** decimals;
    const prices = priceMap.get(addr);
    if (!prices) continue;

    if (!perAsset.has(symbol)) {
      perAsset.set(symbol, {
        symbol,
        supplied: new Array(TARGET_DATES.length).fill(0),
        borrowed: new Array(TARGET_DATES.length).fill(0),
      });
    }
    const acc = perAsset.get(symbol)!;
    for (let i = 0; i < snapshots.length; i++) {
      const m = snapshots[i].get(market.uniqueKey);
      if (!m) continue;
      const price = prices.get(TARGET_DATES[i]);
      if (price === undefined) continue;
      const supUsd = (Number(m.totalSupplyAssets) / Number(scale)) * price;
      const borUsd = (Number(m.totalBorrowAssets) / Number(scale)) * price;
      acc.supplied[i] += supUsd;
      acc.borrowed[i] += borUsd;
    }
  }

  const assets = Array.from(perAsset.values()).sort(
    (a, b) =>
      b.supplied[HACK_IDX] - b.borrowed[HACK_IDX] -
      (a.supplied[HACK_IDX] - a.borrowed[HACK_IDX])
  );

  const totals = new Array(TARGET_DATES.length).fill(0);
  for (const a of assets)
    for (let i = 0; i < TARGET_DATES.length; i++)
      totals[i] += a.supplied[i] - a.borrowed[i];

  const elapsed = Date.now() - t0;
  const lastTvl = totals[totals.length - 1];
  console.log(
    `✓ ${elapsed}ms  ${markets.length} markets  latest net=${
      lastTvl >= 1e9
        ? `$${(lastTvl / 1e9).toFixed(2)}B`
        : `$${(lastTvl / 1e6).toFixed(1)}M`
    }`
  );

  return { name: cfg.name, totals, assets };
}

async function main() {
  const outputPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "public/data/morpho-onchain.json";

  console.log(`Morpho Blue on-chain — ${CHAINS.length} chains × ${TARGET_DATES.length} dates`);
  console.log("Markets list: Morpho GraphQL | Market state: Alchemy RPC | Prices: Llama coins\n");

  const perChain: Awaited<ReturnType<typeof runChain>>[] = [];
  for (const c of CHAINS) {
    try {
      perChain.push(await runChain(c));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${msg.split("\n")[0].slice(0, 80)}`);
    }
  }

  // Aggregate per loan asset across chains
  const assetByName = new Map<
    string,
    { symbol: string; supplied: number[]; borrowed: number[] }
  >();
  for (const { assets } of perChain) {
    for (const a of assets) {
      if (!assetByName.has(a.symbol)) {
        assetByName.set(a.symbol, {
          symbol: a.symbol,
          supplied: new Array(TARGET_DATES.length).fill(0),
          borrowed: new Array(TARGET_DATES.length).fill(0),
        });
      }
      const acc = assetByName.get(a.symbol)!;
      for (let i = 0; i < TARGET_DATES.length; i++) {
        acc.supplied[i] += a.supplied[i];
        acc.borrowed[i] += a.borrowed[i];
      }
    }
  }

  const assetsAggregated = Array.from(assetByName.values())
    .map((a) => ({
      symbol: a.symbol,
      values: a.supplied.map((s, i) => s - a.borrowed[i]),
    }))
    .sort((a, b) => b.values[HACK_IDX] - a.values[HACK_IDX]);

  if (outputPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });

    const out = {
      generatedAt: new Date().toISOString(),
      dates: TARGET_DATES,
      hackDateIndex: HACK_IDX,
      chains: perChain.map((c) => ({
        name: c.name,
        totals: c.totals,
        assets: c.assets.map((a) => ({
          symbol: a.symbol,
          supplied: a.supplied,
          borrowed: a.borrowed,
        })),
      })),
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
