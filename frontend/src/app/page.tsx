import Link from "next/link";
import { getOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const rows = await getOverview();
  const total = rows.reduce((a, r) => a + r.tracked, 0);

  return (
    <>
      <h1>Overview</h1>
      <div className="cards">
        <div className="card">
          <div className="label">Markets tracked</div>
          <div className="big">{total.toLocaleString()}</div>
        </div>
        {rows.map((r) => (
          <div className="card" key={r.category}>
            <div className="label">{r.category}</div>
            <div className="big">{r.tracked.toLocaleString()}</div>
            <div className="muted">
              {r.resolved.toLocaleString()} resolved &middot; {r.pending.toLocaleString()} pending
            </div>
          </div>
        ))}
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
          {rows.map((r) => (
            <tr key={r.category}>
              <td>{r.category}</td>
              <td className="num">{r.tracked.toLocaleString()}</td>
              <td className="num">{r.resolved.toLocaleString()}</td>
              <td className="num">{r.pending.toLocaleString()}</td>
              <td>
                <Link href={`/markets?category=${r.category}`}>open →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
