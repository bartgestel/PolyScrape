import { notFound } from "next/navigation";
import Link from "next/link";
import PriceChart from "@/components/PriceChart";
import { getMarketDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

const fmt = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") : "—");

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getMarketDetail(decodeURIComponent(id));
  if (!detail) notFound();

  const { category, market, snapshots } = detail;

  return (
    <>
      <p className="muted">
        <Link href={`/markets?category=${category}`}>← {category} markets</Link>
      </p>
      <h1>{market.question}</h1>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="kv">
          {category === "sports" ? (
            <>
              <div>Sport</div><div>{market.sport ?? "—"}</div>
              <div>Matchup</div><div>{[market.away_team, market.home_team].filter(Boolean).join(" @ ") || "—"}</div>
              <div>Game start</div><div>{fmt(market.game_start_time ?? null)}</div>
            </>
          ) : (
            <>
              <div>Location</div><div>{market.location ?? "—"}</div>
              <div>Metric</div><div>{market.metric ?? "—"}</div>
              <div>Threshold</div><div>{market.threshold ?? "—"}</div>
            </>
          )}
          <div>Resolves at</div><div>{fmt(market.resolves_at)}</div>
          <div>Snapshots</div><div>{snapshots.length}</div>
          <div>market_id</div><div className="muted">{market.market_id}</div>
        </div>
      </div>

      <PriceChart detail={detail} />
    </>
  );
}
