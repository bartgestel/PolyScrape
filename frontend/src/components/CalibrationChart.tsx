"use client";

import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { CalibrationBin } from "@/lib/types";

export default function CalibrationChart({ bins }: { bins: CalibrationBin[] }) {
  if (bins.length === 0) {
    return <p className="muted">Not enough resolved markets yet to fill any bin (need ≥5 per bin).</p>;
  }
  const data = bins.map((b) => ({
    x: b.predicted_mean,
    y: b.actual_freq,
    n: b.n,
    bin: `${((b.bin_mid - 0.05) * 100).toFixed(0)}–${((b.bin_mid + 0.05) * 100).toFixed(0)}%`,
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
          <CartesianGrid stroke="#2a2f3a" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 1]}
            tickCount={6}
            stroke="#9aa4b2"
            fontSize={11}
            label={{ value: "predicted P(yes)", position: "insideBottom", offset: -8, fill: "#9aa4b2", fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, 1]}
            tickCount={6}
            stroke="#9aa4b2"
            fontSize={11}
            label={{ value: "actual frequency", angle: -90, position: "insideLeft", fill: "#9aa4b2", fontSize: 12 }}
          />
          <ZAxis type="number" dataKey="n" range={[40, 400]} name="markets" />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]}
            stroke="#6b7280"
            strokeDasharray="5 4"
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{ background: "#171a21", border: "1px solid #2a2f3a" }}
          />
          <Scatter data={data} fill="#4f9cf9" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
