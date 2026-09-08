import { notFound } from "next/navigation";
import Link from "next/link";
import PriceChart from "@/components/PriceChart";
import { getMarketDetail } from "@/lib/queries";
import { limitlessUrl } from "@/lib/types";

export const dynamic = "force-dynamic";

const fmt = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") : "—");
const fmtT = (s: string) => new Date(s).toISOString().slice(5, 19).replace("T", " ");

export default async function MarketDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getMarketDetail(decodeURIComponent(slug));
  if (!detail) notFound();

  const { market, snapshots, trades } = detail;
  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);

  return (
    <>
      <p className="muted">
        <Link href="/markets">← markets</Link>
      </p>
      <h1>{market.title}</h1>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="kv">
          <div>Categories</div><div>{market.categories.join(", ") || "—"}</div>
          <div>Type</div>
          <div>
            {market.market_type ?? "—"}
            {market.trade_type ? ` · ${market.trade_type}` : ""}
            {market.frequency ? ` · ${market.frequency}` : ""}
            {market.automation_type ? ` · ${market.automation_type}` : ""}
          </div>
          {market.group_slug && (<><div>Group</div><div className="muted">{market.group_slug}</div></>)}
          {market.oracle_ticker && (
            <>
              <div>Oracle</div>
              <div>
                {market.oracle_ticker} ({market.oracle_asset_type}){market.oracle_source ? ` · ${market.oracle_source}` : ""}
                {market.strike_price != null ? ` · strike ${market.strike_price}` : ""}
              </div>
            </>
          )}
          <div>Costs</div>
          <div>
            max spread {pct(market.max_spread)} · rebate {pct(market.rebate_rate)} · creator fee {pct(market.creator_fee_pct)}
            {market.min_size != null ? ` · min $${market.min_size}` : ""}
            {market.is_rewardable ? " · rewardable" : ""}
          </div>
          <div>Creator</div><div>{market.creator_name ?? "—"}</div>
          <div>Created</div><div>{fmt(market.source_created_at)}</div>
          <div>Expires</div><div>{fmt(market.expiration)}</div>
          <div>Snapshots</div><div>{snapshots.length}</div>
          <div>Trades recorded</div><div>{trades.length}</div>
          <div>Limitless</div>
          <div><a href={limitlessUrl(market.slug)!} target="_blank" rel="noreferrer">{limitlessUrl(market.slug)}</a></div>
          <div>slug</div><div className="muted">{market.slug}</div>
        </div>
      </div>

      <PriceChart detail={detail} />

      {trades.length > 0 && (
        <>
          <h2>Recent trades</h2>
          <table>
            <thead>
              <tr>
                <th className="no-sort">Time</th>
                <th className="no-sort">Side</th>
                <th className="no-sort">Outcome</th>
                <th className="no-sort num">Price</th>
                <th className="no-sort num">Size</th>
                <th className="no-sort num">USDC</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 50).map((t, i) => (
                <tr key={i}>
                  <td>{fmtT(t.created_at)}</td>
                  <td className={t.side === "buy" ? "" : "muted"}>{t.side}</td>
                  <td>{t.outcome ?? "—"}</td>
                  <td className="num">{t.price?.toFixed(3) ?? "—"}</td>
                  <td className="num">{t.size?.toFixed(0) ?? "—"}</td>
                  <td className="num">{t.collateral?.toFixed(0) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
