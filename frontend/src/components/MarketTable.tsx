"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { limitlessUrl, type MarketRow } from "@/lib/types";

type SortKey = "title" | "expiration" | "last_price" | "status";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") : "—";
const fmtPrice = (p: number | null) => (p == null ? "—" : p.toFixed(3));

const groupTitleOf = (t: string) => t.split(" — ")[0];
const childLabelOf = (t: string) => {
  const i = t.indexOf(" — ");
  return i === -1 ? t : t.slice(i + 3);
};
const expMs = (r: MarketRow) => (r.expiration ? Date.parse(r.expiration) : -Infinity);

type Entry =
  | { kind: "single"; key: string; row: MarketRow }
  | {
      kind: "collapsed";
      variant: "group" | "series";
      key: string;
      title: string;
      children: MarketRow[]; // groups: outcome order; series: newest expiration first
      categories: string[];
      expiration: string | null;
      headline: { label: string | null; price: number } | null;
      resolved: boolean; // group: any child resolved; series: all resolved
      resolvedLabel: string | null;
    };

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
  const [open, setOpen] = useState<Set<string>>(new Set());

  const entries = useMemo(() => {
    const t = text.trim().toLowerCase();
    const matched = rows.filter(
      (r) => !t || `${r.title} ${r.categories.join(" ")}`.toLowerCase().includes(t),
    );

    const groups = new Map<string, MarketRow[]>();
    const series = new Map<string, MarketRow[]>();
    const singles: MarketRow[] = [];
    for (const r of matched) {
      const bucket = r.group_slug ? groups : r.stable_slug ? series : null;
      if (!bucket) {
        singles.push(r);
        continue;
      }
      const key = (r.group_slug ?? r.stable_slug) as string;
      const arr = bucket.get(key);
      if (arr) arr.push(r);
      else bucket.set(key, [r]);
    }

    const list: Entry[] = singles.map((row) => ({ kind: "single", key: row.slug, row }));

    for (const [key, children] of groups) {
      const fav = children
        .filter((c) => c.last_price != null)
        .sort((a, b) => (b.last_price as number) - (a.last_price as number))[0];
      const won = children.find((c) => c.winning_outcome_index === 0);
      list.push({
        kind: "collapsed",
        variant: "group",
        key,
        title: groupTitleOf(children[0].title),
        children,
        categories: children[0].categories,
        expiration: children[0].expiration,
        headline: fav ? { label: childLabelOf(fav.title), price: fav.last_price as number } : null,
        resolved: children.some((c) => c.winning_outcome),
        resolvedLabel: won ? childLabelOf(won.title) : null,
      });
    }

    for (const [key, all] of series) {
      if (all.length === 1) {
        list.push({ kind: "single", key: all[0].slug, row: all[0] });
        continue;
      }
      const children = [...all].sort((a, b) => expMs(b) - expMs(a));
      const latest = children[0];
      list.push({
        kind: "collapsed",
        variant: "series",
        key,
        title: latest.title,
        children,
        categories: latest.categories,
        expiration: latest.expiration,
        headline: latest.last_price != null ? { label: null, price: latest.last_price } : null,
        resolved: children.every((c) => c.winning_outcome),
        resolvedLabel: null,
      });
    }

    const isResolved = (e: Entry) => (e.kind === "single" ? !!e.row.winning_outcome : e.resolved);
    const filtered = list.filter((e) => {
      if (status === "resolved") return isResolved(e);
      if (status === "pending") return !isResolved(e);
      return true;
    });

    const val = (e: Entry): string | number => {
      if (sort === "status") return isResolved(e) ? 1 : 0;
      if (e.kind === "single") {
        switch (sort) {
          case "title": return e.row.title.toLowerCase();
          case "expiration": return expMs(e.row);
          case "last_price": return e.row.last_price ?? -Infinity;
        }
      } else {
        switch (sort) {
          case "title": return e.title.toLowerCase();
          case "expiration": return e.expiration ? Date.parse(e.expiration) : -Infinity;
          case "last_price": return e.headline?.price ?? -Infinity;
        }
      }
      return 0;
    };
    return filtered.sort((a, b) => {
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

  const pill = (label: string, kind: "resolved" | "pending" = "resolved") => (
    <span className={`pill ${kind}`}>{label}</span>
  );
  const singleStatus = (r: MarketRow) =>
    r.winning_outcome ? pill(r.winning_outcome) : pill("pending", "pending");

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
        <span className="muted">{entries.length} entries</span>
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
          {entries.map((e) => {
            if (e.kind === "single") {
              return (
                <tr key={e.key}>
                  <td><Link href={`/markets/${encodeURIComponent(e.row.slug)}`}>{e.row.title}</Link></td>
                  <td className="muted">{e.row.categories.join(", ") || "—"}</td>
                  <td>{fmtDate(e.row.expiration)}</td>
                  <td className="num">{fmtPrice(e.row.last_price)}</td>
                  <td>{singleStatus(e.row)}</td>
                  <td><a href={limitlessUrl(e.row.slug)!} target="_blank" rel="noreferrer" title="Open on Limitless">↗</a></td>
                </tr>
              );
            }
            const noun = e.variant === "group" ? "outcomes" : "markets";
            const headline =
              e.headline == null
                ? "—"
                : e.headline.label
                  ? `${e.headline.label} ${e.headline.price.toFixed(3)}`
                  : e.headline.price.toFixed(3);
            const parentStatus =
              e.variant === "group"
                ? e.resolvedLabel
                  ? pill(e.resolvedLabel)
                  : e.resolved
                    ? pill("resolved")
                    : pill("pending", "pending")
                : e.resolved
                  ? pill("all resolved")
                  : pill("live", "pending");
            const lmSlug = e.children[0].slug;
            return (
              <Fragment key={e.key}>
                <tr
                  className="group-row"
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      n.has(e.key) ? n.delete(e.key) : n.add(e.key);
                      return n;
                    })
                  }
                >
                  <td>
                    <span className="caret">{open.has(e.key) ? "▾" : "▸"}</span> {e.title}{" "}
                    <span className="muted">({e.children.length} {noun})</span>
                  </td>
                  <td className="muted">{e.categories.join(", ") || "—"}</td>
                  <td>{fmtDate(e.expiration)}</td>
                  <td className="num">{headline}</td>
                  <td>{parentStatus}</td>
                  <td>
                    <a href={limitlessUrl(lmSlug)!} target="_blank" rel="noreferrer" title="Open on Limitless" onClick={(ev) => ev.stopPropagation()}>↗</a>
                  </td>
                </tr>
                {open.has(e.key) &&
                  e.children.map((c) => (
                    <tr key={c.slug} className="child-row">
                      <td className="indent">
                        <Link href={`/markets/${encodeURIComponent(c.slug)}`}>
                          {e.variant === "group" ? childLabelOf(c.title) : fmtDate(c.expiration)}
                        </Link>
                      </td>
                      <td />
                      <td />
                      <td className="num">{fmtPrice(c.last_price)}</td>
                      <td>
                        {e.variant === "group" ? (
                          c.winning_outcome_index === 0 ? pill("won") : c.winning_outcome ? pill("lost", "pending") : pill("—", "pending")
                        ) : (
                          singleStatus(c)
                        )}
                      </td>
                      <td><a href={limitlessUrl(c.slug)!} target="_blank" rel="noreferrer">↗</a></td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
