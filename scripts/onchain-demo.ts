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
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`),
});

const DATA_PROVIDER_ABI = parseAbi([
  "function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])",
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const ORACLE_ABI = parseAbi([
  "function getAssetsPrices(address[] assets) view returns (uint256[])",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
]);

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

async function main() {
  const dataProvider = getAddress(AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER);
  const oracle = getAddress(AaveV3Ethereum.ORACLE);

  const block = await client.getBlock();
  console.log(
    `Reading Aave V3 Ethereum at block ${block.number} (${new Date(
      Number(block.timestamp) * 1000
    ).toISOString()})`
  );

  const reservesList = (await client.readContract({
    address: dataProvider,
    abi: DATA_PROVIDER_ABI,
    functionName: "getAllReservesTokens",
  })) as readonly { symbol: string; tokenAddress: `0x${string}` }[];
  console.log(`Found ${reservesList.length} reserves\n`);

  const assets = reservesList.map((r) => r.tokenAddress);

  const [reserveData, prices, baseUnit, decimalsArr] = await Promise.all([
    Promise.all(
      assets.map((a) =>
        client.readContract({
          address: dataProvider,
          abi: DATA_PROVIDER_ABI,
          functionName: "getReserveData",
          args: [a],
        })
      )
    ),
    client.readContract({
      address: oracle,
      abi: ORACLE_ABI,
      functionName: "getAssetsPrices",
      args: [assets],
    }) as Promise<readonly bigint[]>,
    client.readContract({
      address: oracle,
      abi: ORACLE_ABI,
      functionName: "BASE_CURRENCY_UNIT",
    }) as Promise<bigint>,
    Promise.all(
      assets.map((a) =>
        client.readContract({
          address: a,
          abi: ERC20_ABI,
          functionName: "decimals",
        })
      )
    ) as Promise<number[]>,
  ]);

  type Row = {
    symbol: string;
    supplied: number;
    borrowed: number;
    net: number;
  };
  const rows: Row[] = [];
  for (let i = 0; i < assets.length; i++) {
    const rd = reserveData[i] as readonly bigint[];
    const totalAToken = rd[2];
    const totalStableDebt = rd[3];
    const totalVariableDebt = rd[4];
    const totalDebt = totalStableDebt + totalVariableDebt;
    const price = prices[i];
    const dec = BigInt(decimalsArr[i]);
    const scale = 10n ** dec;

    const supUsd =
      Number((totalAToken * price) / scale) / Number(baseUnit);
    const borUsd =
      Number((totalDebt * price) / scale) / Number(baseUnit);

    rows.push({
      symbol: reservesList[i].symbol,
      supplied: supUsd,
      borrowed: borUsd,
      net: supUsd - borUsd,
    });
  }

  rows.sort((a, b) => b.supplied - a.supplied);

  const col = (s: string, w: number, right = false) =>
    right ? s.padStart(w) : s.padEnd(w);

  console.log(
    col("Asset", 14) +
      col("Supplied", 14, true) +
      col("Borrowed", 14, true) +
      col("Net TVL", 14, true)
  );
  console.log("-".repeat(56));

  let totSup = 0,
    totBor = 0;
  for (const r of rows) {
    totSup += r.supplied;
    totBor += r.borrowed;
    if (r.supplied >= 10_000_000) {
      console.log(
        col(r.symbol, 14) +
          col(fmtUsd(r.supplied), 14, true) +
          col(fmtUsd(r.borrowed), 14, true) +
          col(fmtUsd(r.net), 14, true)
      );
    }
  }
  console.log("-".repeat(56));
  console.log(
    col(`TOTAL (${rows.length} assets)`, 14) +
      col(fmtUsd(totSup), 14, true) +
      col(fmtUsd(totBor), 14, true) +
      col(fmtUsd(totSup - totBor), 14, true)
  );

  const rsEth = rows.find((r) => r.symbol.toLowerCase().includes("rseth"));
  if (rsEth) {
    console.log(
      `\n🎯 rsETH (hacked asset) live:\n   supplied=${fmtUsd(
        rsEth.supplied
      )}  borrowed=${fmtUsd(rsEth.borrowed)}  net=${fmtUsd(rsEth.net)}`
    );
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
