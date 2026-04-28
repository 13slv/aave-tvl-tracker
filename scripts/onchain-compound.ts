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
import { mainnet, arbitrum, base, polygon, optimism } from "viem/chains";

const apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) {
  console.error("ALCHEMY_API_KEY not found");
  process.exit(1);
}

type CometCfg = { name: string; address: `0x${string}` };
type ChainCfg = {
  name: string;
  chain: Chain;
  rpcBase: string;
  llamaChain: string;
  comets: CometCfg[];
};

const CHAINS: ChainCfg[] = [
  {
    name: "Ethereum",
    chain: mainnet,
    rpcBase: "eth-mainnet.g.alchemy.com",
    llamaChain: "ethereum",
    comets: [
      { name: "cUSDCv3", address: getAddress("0xc3d688B66703497DAA19211EEdff47f25384cdc3") },
      { name: "cWETHv3", address: getAddress("0xA17581A9E3356d9A858b789D68B4d866e593aE94") },
      { name: "cUSDTv3", address: getAddress("0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840") },
      { name: "cUSDSv3", address: getAddress("0x5D409e56D886231aDAf00c8775665AD0f9897b56") },
    ],
  },
  {
    name: "Base",
    chain: base,
    rpcBase: "base-mainnet.g.alchemy.com",
    llamaChain: "base",
    comets: [
      { name: "cUSDCv3", address: getAddress("0xb125E6687d4313864e53df431d5425969c15Eb2F") },
      { name: "cWETHv3", address: getAddress("0x46e6b214b524310239732D51387075E0e70970bf") },
      { name: "cUSDbCv3", address: getAddress("0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf") },
      { name: "cAEROv3", address: getAddress("0x784efeB622244d2348d4F2522f8860B96fbEcE89") },
    ],
  },
  {
    name: "Arbitrum",
    chain: arbitrum,
    rpcBase: "arb-mainnet.g.alchemy.com",
    llamaChain: "arbitrum",
    comets: [
      { name: "cUSDCv3", address: getAddress("0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf") },
      { name: "cUSDC.ev3", address: getAddress("0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA") },
      { name: "cWETHv3", address: getAddress("0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486") },
      { name: "cUSDTv3", address: getAddress("0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07") },
    ],
  },
  {
    name: "Optimism",
    chain: optimism,
    rpcBase: "opt-mainnet.g.alchemy.com",
    llamaChain: "optimism",
    comets: [
      { name: "cUSDCv3", address: getAddress("0x2e44e174f7D53F0212823acC11C01A11d58c5bCB") },
      { name: "cUSDTv3", address: getAddress("0x995E394b8B2437aC8Ce61Ee0bC610D617962B214") },
      { name: "cWETHv3", address: getAddress("0xE36A30D249f7761327fd973001A32010b521b6Fd") },
    ],
  },
  {
    name: "Polygon",
    chain: polygon,
    rpcBase: "polygon-mainnet.g.alchemy.com",
    llamaChain: "polygon",
    comets: [
      { name: "cUSDCv3", address: getAddress("0xF25212E676D1F7F89Cd72fFEe66158f541246445") },
      { name: "cUSDTv3", address: getAddress("0xaeB318360f27748Acb200CE616E389A6C9409a07") },
    ],
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

const COMET_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function totalBorrow() view returns (uint256)",
  "function baseToken() view returns (address)",
  "function numAssets() view returns (uint8)",
  "function getAssetInfo(uint8 i) view returns ((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))",
  "function totalsCollateral(address asset) view returns (uint128 totalSupplyAsset, uint128 _reserved)",
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
  addresses: Hex[]
): Promise<Map<string, Map<string, number>>> {
  if (addresses.length === 0) return new Map();
  const tokens = addresses.map((a) => `${llamaChain}:${a.toLowerCase()}`).join(",");
  const start = TARGET_TIMESTAMPS[0];
  const url = `https://coins.llama.fi/chart/${tokens}?start=${start}&span=${TARGET_DATES.length}&period=1d`;
  const res = await fetch(url);
  if (!res.ok) return new Map();
  const json = (await res.json()) as {
    coins: Record<string, { prices: LlamaChartPoint[] }>;
  };
  const result = new Map<string, Map<string, number>>();
  for (const [key, info] of Object.entries(json.coins)) {
    const m = new Map<string, number>();
    info.prices.forEach((p, i) => {
      if (i < TARGET_DATES.length) m.set(TARGET_DATES[i], p.price);
    });
    result.set(key.split(":")[1].toLowerCase(), m);
  }
  return result;
}

type AssetInfo = {
  offset: number;
  asset: `0x${string}`;
  priceFeed: `0x${string}`;
  scale: bigint;
  borrowCollateralFactor: bigint;
  liquidateCollateralFactor: bigint;
  liquidationFactor: bigint;
  supplyCap: bigint;
};

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

  // 1. Discover base + collaterals for each comet
  type CometInfo = {
    name: string;
    address: `0x${string}`;
    baseToken: `0x${string}`;
    collaterals: `0x${string}`[];
  };
  const cometInfos: CometInfo[] = [];

  for (const c of cfg.comets) {
    try {
      const [baseToken, numAssetsRaw] = await Promise.all([
        client.readContract({
          address: c.address,
          abi: COMET_ABI,
          functionName: "baseToken",
        }) as Promise<`0x${string}`>,
        client.readContract({
          address: c.address,
          abi: COMET_ABI,
          functionName: "numAssets",
        }) as Promise<number>,
      ]);
      const numAssets = Number(numAssetsRaw);
      const collaterals: `0x${string}`[] = [];
      const calls = Array.from({ length: numAssets }, (_, i) => ({
        address: c.address,
        abi: COMET_ABI,
        functionName: "getAssetInfo" as const,
        args: [i] as const,
      }));
      const infos = (await client.multicall({
        contracts: calls,
        allowFailure: false,
      })) as AssetInfo[];
      for (const ai of infos) collaterals.push(getAddress(ai.asset));
      cometInfos.push({
        name: c.name,
        address: c.address,
        baseToken: getAddress(baseToken),
        collaterals,
      });
    } catch (e: unknown) {
      console.log(`\n    ${c.name} discovery failed: ${(e as Error).message?.slice(0, 60)}`);
    }
  }

  if (cometInfos.length === 0) {
    console.log("✗ no comets discovered");
    return null;
  }

  // 2. Fetch token metadata for all unique tokens (base + collaterals)
  const allTokens = new Set<string>();
  for (const ci of cometInfos) {
    allTokens.add(ci.baseToken.toLowerCase());
    for (const c of ci.collaterals) allTokens.add(c.toLowerCase());
  }
  const tokenList = Array.from(allTokens) as `0x${string}`[];

  const meta = await client.multicall({
    contracts: tokenList.flatMap((t) => [
      { address: getAddress(t), abi: ERC20_ABI, functionName: "symbol" as const },
      { address: getAddress(t), abi: ERC20_ABI, functionName: "decimals" as const },
    ]),
    allowFailure: true,
  });
  const symbolMap = new Map<string, string>();
  const decimalsMap = new Map<string, number>();
  tokenList.forEach((t, i) => {
    const sym = meta[i * 2];
    const dec = meta[i * 2 + 1];
    symbolMap.set(t, sym.status === "success" ? (sym.result as string) : t.slice(0, 8));
    decimalsMap.set(t, dec.status === "success" ? (dec.result as number) : 18);
  });

  // 3. Historical prices for all tokens
  const priceMap = await fetchHistoricalPrices(cfg.llamaChain, tokenList);

  // 4. Block lookups
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

  // 5. Per-block: for each comet, query totalSupply, totalBorrow + totalsCollateral for each collateral
  type Snap = Map<string, { supplied: number; borrowed: number; symbol: string }>;
  const snapshots: Snap[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const blockNumber = blocks[i];
    const calls: { address: `0x${string}`; abi: typeof COMET_ABI; functionName: "totalSupply" | "totalBorrow" | "totalsCollateral"; args?: readonly [`0x${string}`] }[] = [];
    const callMeta: {
      type: "supply" | "borrow" | "collateral";
      cometIdx: number;
      collateralIdx?: number;
    }[] = [];
    cometInfos.forEach((ci, cidx) => {
      calls.push({ address: ci.address, abi: COMET_ABI, functionName: "totalSupply" });
      callMeta.push({ type: "supply", cometIdx: cidx });
      calls.push({ address: ci.address, abi: COMET_ABI, functionName: "totalBorrow" });
      callMeta.push({ type: "borrow", cometIdx: cidx });
      ci.collaterals.forEach((col, colIdx) => {
        calls.push({
          address: ci.address,
          abi: COMET_ABI,
          functionName: "totalsCollateral",
          args: [col] as const,
        });
        callMeta.push({ type: "collateral", cometIdx: cidx, collateralIdx: colIdx });
      });
    });

    const results = await client.multicall({
      contracts: calls as Parameters<typeof client.multicall>[0]["contracts"],
      blockNumber,
      allowFailure: true,
    });

    const snap: Snap = new Map();
    const SANITY_CAP_USD = 10_000_000_000;

    function add(symbol: string, supplied: number, borrowed: number) {
      const v = snap.get(symbol) ?? { supplied: 0, borrowed: 0, symbol };
      v.supplied += supplied;
      v.borrowed += borrowed;
      snap.set(symbol, v);
    }

    for (let j = 0; j < calls.length; j++) {
      const r = results[j];
      const m = callMeta[j];
      if (r.status !== "success") continue;
      const ci = cometInfos[m.cometIdx];

      if (m.type === "supply" || m.type === "borrow") {
        const baseAddr = ci.baseToken.toLowerCase();
        const symbol = symbolMap.get(baseAddr) ?? "?";
        const decimals = BigInt(decimalsMap.get(baseAddr) ?? 18);
        const scale = 10n ** decimals;
        const price = priceMap.get(baseAddr)?.get(TARGET_DATES[i]) ?? 0;
        if (price === 0) continue;
        const usd = (Number(r.result as bigint) / Number(scale)) * price;
        if (usd > SANITY_CAP_USD) continue;
        if (m.type === "supply") add(symbol, usd, 0);
        else add(symbol, 0, usd);
      } else if (m.type === "collateral" && m.collateralIdx !== undefined) {
        const colAddr = ci.collaterals[m.collateralIdx].toLowerCase();
        const symbol = symbolMap.get(colAddr) ?? "?";
        const decimals = BigInt(decimalsMap.get(colAddr) ?? 18);
        const scale = 10n ** decimals;
        const price = priceMap.get(colAddr)?.get(TARGET_DATES[i]) ?? 0;
        if (price === 0) continue;
        // totalsCollateral returns (uint128 totalSupplyAsset, uint128 _reserved) as array
        const result = r.result as readonly [bigint, bigint];
        const totalSupplyAsset = result[0];
        const usd = (Number(totalSupplyAsset) / Number(scale)) * price;
        if (usd > SANITY_CAP_USD) continue;
        add(symbol, usd, 0);
      }
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
    `✓ ${elapsed}ms  ${cometInfos.length} markets  latest=${fmtUsd(lastTvl)}`
  );

  return { name: cfg.name, totals, snapshots };
}

async function main() {
  const outputPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "public/data/compound-onchain.json";

  console.log(`Compound V3 on-chain — ${CHAINS.length} chains × ${TARGET_DATES.length} dates`);
  console.log("Comet contracts | Prices: Llama coins\n");

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
