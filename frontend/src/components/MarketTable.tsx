"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Category, MarketRow } from "@/lib/types";

type SortKey = "question" | "group" | "resolves_at" | "last_price" | "status";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toISOString().slice(0, 16).replace("T", " ");
}
function fmtPrice(p: number | null): string {
  return p == null ? "—" : p.toFixed(3);
}

export default function MarketTable({ category, rows }: { category: Category; rows: MarketRow[] }) {
  const [text, setText] = useState("");
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState<"all" | "resolved" | "pending">("all");
  const [sort, setSort] = useState<SortKey>("resolves_at");
  const [dir, setDir] = useState<1 | -1>(-1);

  const groupOf = (r: MarketRow) => (category === "sports" ? r.sport : r.metric) ?? "—";
  const subtitleOf = (r: MarketRow) =>
    category === "sports"
      ? [r.away_team, r.home_team].filter(Boolean).join(" @ ")
      : [r.location, r.threshold != null ? `thr ${r.threshold}` : null].filter(Boolean).join(" · ");

  const groups = useMemo(
    () => Array.from(new Set(rows.map(groupOf))).sort(),
    [rows], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase();
    const arr = rows.filter((r) => {
      if (group !== "all" && groupOf(r) !== group) return false;
      if (status === "resolved" && !r.outcome) return false;
      if (status === "pending" && r.outcome) return false;
      if (t && !(`${r.question} ${subtitleOf(r)}`.toLowerCase().includes(t))) return false;
      return true;
    });
    const val = (r: MarketRow): string | number => {
      switch (sort) {
        case "question": return r.question.toLowerCase();
        case "group": return groupOf(r) ?? "";
        case "resolves_at": return r.resolves_at ? Date.parse(r.resolves_at) : -Infinity;
        case "last_price": return r.last_price ?? -Infinity;
        case "status": return r.outcome ? 1 : 0;
      }
    };
    return [...arr].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, text, group, status, sort, dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = (key: SortKey, label: string, cls = "") => (
    <th
      className={cls}
      onClick={() => {
        if (sort === key) setDir((d) => (d === 1 ? -1 : 1));
        else { setSort(key); setDir(1); }
      }}
    >
      {label} {sort === key ? (dir === 1 ? "▲" : "▼") : ""}
    </th>
  );

  return (
    <>
      <div className="controls">
        <input placeholder="filter text…" value={text} onChange={(e) => setText(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="all">{category === "sports" ? "all sports" : "all metrics"}</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">all</option>
          <option value="pending">pending</option>
          <option value="resolved">resolved</option>
        </select>
        <span className="muted">{filtered.length} of {rows.length}</span>
      </div>

      <table>
        <thead>
          <tr>
            {th("question", "Market")}
            {th("group", category === "sports" ? "Sport" : "Metric")}
            {th("resolves_at", "Resolves")}
            {th("last_price", "Last P(yes)", "num")}
            {th("status", "Status")}
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.market_id}>
              <td>
                <Link href={`/markets/${encodeURIComponent(r.market_id)}`}>{r.question}</Link>
                <div className="muted">{subtitleOf(r)}</div>
              </td>
              <td>{groupOf(r)}</td>
              <td>{fmtDate(r.resolves_at)}</td>
              <td className="num">{fmtPrice(r.last_price)}</td>
              <td>
                {r.outcome ? (
                  <span className="pill resolved">{r.outcome}</span>
                ) : (
                  <span className="pill pending">pending</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
