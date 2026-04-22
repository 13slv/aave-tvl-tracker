import { getTvlData } from "@/lib/tvl";
import TvlDashboard from "@/components/TvlDashboard";

export const revalidate = 3600;

export default async function Home() {
  const data = await getTvlData();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Aave V3 TVL &mdash; KelpDAO hack impact
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Daily TVL across chains and assets around the April 18, 2026
            KelpDAO/LayerZero bridge exploit. Data:{" "}
            <a
              href="https://defillama.com/protocol/aave-v3"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-900 dark:hover:text-white"
            >
              DefiLlama
            </a>
            , refreshed hourly.
          </p>
        </header>

        <TvlDashboard data={data} />

        <footer className="mt-12 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
          <p>
            Hack: ~$292M rsETH drained via 1-of-1 DVN in KelpDAO&apos;s
            LayerZero OFT bridge. Aave bad debt est. $124-230M. Baseline
            column highlighted = last snapshot before exploit.
          </p>
        </footer>
      </main>
    </div>
  );
}
