"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { limitlessUrl, type MarketRow } from "@/lib/types";

type SortKey = "title" | "expiration" | "last_price" | "status";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") : "—";
const fmtPrice = (p: number | null) => (p == null ? "—" : p.toFixed(3));

export default function MarketTable({
  rows,
  categories,
  activeCategory,
}: {
  rows: MarketRow[];
  categories: string[];
  activeCategory: string | null;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"all" | "resolved" | "pending">("all");
  const [sort, setSort] = useState<SortKey>("expiration");
  const [dir, setDir] = useState<1 | -1>(-1);

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase();
    const arr = rows.filter((r) => {
      if (status === "resolved" && !r.winning_outcome) return false;
      if (status === "pending" && r.winning_outcome) return false;
      if (t && !`${r.title} ${r.categories.join(" ")}`.toLowerCase().includes(t)) return false;
      return true;
    });
    const val = (r: MarketRow): string | number => {
      switch (sort) {
        case "title": return r.title.toLowerCase();
        case "expiration": return r.expiration ? Date.parse(r.expiration) : -Infinity;
        case "last_price": return r.last_price ?? -Infinity;
        case "status": return r.winning_outcome ? 1 : 0;
      }
    };
    return [...arr].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, text, status, sort, dir]);

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
        <select
          value={activeCategory ?? "all"}
          onChange={(e) => {
            const v = e.target.value;
            window.location.href = v === "all" ? "/markets" : `/markets?category=${encodeURIComponent(v)}`;
          }}
        >
          <option value="all">all categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
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
            {th("title", "Market")}
            <th className="no-sort">Categories</th>
            {th("expiration", "Expires")}
            {th("last_price", "Last P(yes)", "num")}
            {th("status", "Status")}
            <th className="no-sort">LM</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.slug}>
              <td>
                <Link href={`/markets/${encodeURIComponent(r.slug)}`}>{r.title}</Link>
              </td>
              <td className="muted">{r.categories.join(", ") || "—"}</td>
              <td>{fmtDate(r.expiration)}</td>
              <td className="num">{fmtPrice(r.last_price)}</td>
              <td>
                {r.winning_outcome ? (
                  <span className="pill resolved">{r.winning_outcome}</span>
                ) : (
                  <span className="pill pending">pending</span>
                )}
              </td>
              <td>
                <a href={limitlessUrl(r.slug)!} target="_blank" rel="noreferrer" title="Open on Limitless">↗</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
