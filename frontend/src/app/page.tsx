import Link from "next/link";
import { getOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const o = await getOverview();

  return (
    <>
      <h1>Overview</h1>
      <div className="cards">
        <div className="card">
          <div className="label">Markets tracked</div>
          <div className="big">{o.totalMarkets.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="label">Resolved</div>
          <div className="big">{o.resolved.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="label">Pending</div>
          <div className="big">{o.pending.toLocaleString()}</div>
        </div>
      </div>

      <h2>By category</h2>
      <table>
        <thead>
          <tr>
            <th className="no-sort">Category</th>
            <th className="no-sort num">Tracked</th>
            <th className="no-sort num">Resolved</th>
            <th className="no-sort num">Pending</th>
            <th className="no-sort">Browse</th>
          </tr>
        </thead>
        <tbody>
          {o.byCategory.map((c) => (
            <tr key={c.category}>
              <td>{c.category}</td>
              <td className="num">{c.tracked.toLocaleString()}</td>
              <td className="num">{c.resolved.toLocaleString()}</td>
              <td className="num">{(c.tracked - c.resolved).toLocaleString()}</td>
              <td>
                <Link href={`/markets?category=${encodeURIComponent(c.category)}`}>open →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 12 }}>
        A market can belong to several categories, so category rows sum to more than the total.
      </p>
    </>
  );
}
