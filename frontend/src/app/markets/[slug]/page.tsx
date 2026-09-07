import { notFound } from "next/navigation";
import Link from "next/link";
import PriceChart from "@/components/PriceChart";
import { getMarketDetail } from "@/lib/queries";
import { limitlessUrl } from "@/lib/types";

export const dynamic = "force-dynamic";

const fmt = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") : "—");

export default async function MarketDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getMarketDetail(decodeURIComponent(slug));
  if (!detail) notFound();

  const { market, snapshots } = detail;

  return (
    <>
      <p className="muted">
        <Link href="/markets">← markets</Link>
      </p>
      <h1>{market.title}</h1>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="kv">
          <div>Categories</div><div>{market.categories.join(", ") || "—"}</div>
          <div>Type</div><div>{market.market_type ?? "—"}{market.trade_type ? ` · ${market.trade_type}` : ""}</div>
          {market.group_slug && (<><div>Group</div><div className="muted">{market.group_slug}</div></>)}
          <div>Created</div><div>{fmt(market.source_created_at)}</div>
          <div>Expires</div><div>{fmt(market.expiration)}</div>
          <div>Snapshots</div><div>{snapshots.length}</div>
          <div>Limitless</div>
          <div><a href={limitlessUrl(market.slug)!} target="_blank" rel="noreferrer">{limitlessUrl(market.slug)}</a></div>
          <div>slug</div><div className="muted">{market.slug}</div>
        </div>
      </div>

      <PriceChart detail={detail} />
    </>
  );
}
