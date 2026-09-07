"use client";

import { useEffect, useState } from "react";
import CalibrationChart from "@/components/CalibrationChart";
import type { CalibrationResult } from "@/lib/types";

export default function CalibrationPage() {
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("");
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<CalibrationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((c: string[]) => setCategories(c))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams({ hoursBeforeExpiration: String(hours) });
    if (category) qs.set("category", category);
    fetch(`/api/calibration?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CalibrationResult) => setData(d))
      .catch((e) => {
        if (e.name !== "AbortError") setErr(String(e.message ?? e));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [category, hours]);

  return (
    <>
      <h1>Calibration</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        Resolved markets bucketed by their market-implied P(yes) at a fixed lead time before
        expiration, plotted as predicted probability vs. observed outcome frequency. Points on the
        dashed diagonal mean the market priced that bucket correctly.
      </p>

      <div className="controls">
        <label>
          category{" "}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">all</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          hours before expiration{" "}
          <input
            type="number"
            min={0}
            step={1}
            value={hours}
            onChange={(e) => setHours(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 70 }}
          />
        </label>
        {loading && <span className="muted">loading…</span>}
      </div>

      {err && <p className="err">{err}</p>}

      {data && (
        <>
          <p className="muted">
            {data.resolvedMarkets.toLocaleString()} resolved{data.category ? ` in ${data.category}` : ""} ·{" "}
            {data.matchedMarkets.toLocaleString()} had a snapshot within ±{data.matchToleranceHours}h of the
            lead time · bins with &lt;{data.minBinSize} markets hidden
          </p>
          <CalibrationChart bins={data.bins} />
          <h2>Bins</h2>
          <table>
            <thead>
              <tr>
                <th className="no-sort">Bucket</th>
                <th className="no-sort num">Markets</th>
                <th className="no-sort num">Mean predicted</th>
                <th className="no-sort num">Actual freq</th>
              </tr>
            </thead>
            <tbody>
              {data.bins.map((b) => (
                <tr key={b.bin_mid}>
                  <td>{((b.bin_mid - 0.05) * 100).toFixed(0)}–{((b.bin_mid + 0.05) * 100).toFixed(0)}%</td>
                  <td className="num">{b.n}</td>
                  <td className="num">{b.predicted_mean.toFixed(3)}</td>
                  <td className="num">{b.actual_freq.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
