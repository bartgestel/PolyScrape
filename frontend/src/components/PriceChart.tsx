"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketDetail } from "@/lib/types";

const fmtTs = (t: number) => new Date(t).toISOString().slice(5, 16).replace("T", " ");

export default function PriceChart({ detail }: { detail: MarketDetail }) {
  const data = detail.snapshots
    .filter((s) => s.price_yes != null)
    .map((s) => ({
      t: Date.parse(s.ts),
      price_yes: s.price_yes,
      midpoint: s.midpoint,
      spread: s.spread,
      volume: s.volume,
    }));

  if (data.length === 0) return <p className="muted">No snapshots recorded yet for this market.</p>;

  const res = detail.resolution;
  const resolvedT = res?.resolved_at ? Date.parse(res.resolved_at) : null;
  const last = data[data.length - 1];
  const finalPrice = last.price_yes as number;

  return (
    <>
      {res && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="kv">
            <div>Winning outcome</div>
            <div>{res.winning_outcome ?? "—"} (index {res.winning_outcome_index ?? "—"})</div>
            <div>Final market P(yes)</div>
            <div>{finalPrice.toFixed(3)}</div>
            <div>Status</div>
            <div>{res.status ?? "—"}</div>
            <div>Recorded at</div>
            <div>{res.resolved_at ? fmtTs(Date.parse(res.resolved_at)) : "—"}</div>
          </div>
        </div>
      )}

      <div className="chart-wrap">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#2a2f3a" />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtTs} stroke="#9aa4b2" fontSize={11} />
            <YAxis domain={[0, 1]} stroke="#9aa4b2" fontSize={11} width={40} />
            <Tooltip labelFormatter={(t) => fmtTs(Number(t))} contentStyle={{ background: "#171a21", border: "1px solid #2a2f3a" }} />
            <Line type="monotone" dataKey="price_yes" stroke="#4f9cf9" dot={false} strokeWidth={2} name="P(yes)" isAnimationActive={false} />
            <Line type="monotone" dataKey="midpoint" stroke="#3a4356" dot={false} strokeWidth={1} name="midpoint" isAnimationActive={false} />
            {resolvedT != null && (
              <ReferenceLine x={resolvedT} stroke="#f85149" strokeDasharray="4 3" label={{ value: "resolved", fill: "#f85149", fontSize: 11 }} />
            )}
            {resolvedT != null && <ReferenceDot x={last.t} y={finalPrice} r={4} fill="#f85149" stroke="none" />}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Spread &amp; volume</h2>
      <div className="chart-wrap small">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#2a2f3a" />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtTs} stroke="#9aa4b2" fontSize={11} />
            <YAxis yAxisId="s" stroke="#9aa4b2" fontSize={11} width={40} />
            <YAxis yAxisId="v" orientation="right" stroke="#9aa4b2" fontSize={11} width={52} />
            <Tooltip labelFormatter={(t) => fmtTs(Number(t))} contentStyle={{ background: "#171a21", border: "1px solid #2a2f3a" }} />
            <Line yAxisId="s" type="monotone" dataKey="spread" stroke="#d29922" dot={false} name="spread" isAnimationActive={false} />
            <Line yAxisId="v" type="monotone" dataKey="volume" stroke="#3fb950" dot={false} name="volume" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
