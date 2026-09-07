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

type Entry =
  | { kind: "single"; key: string; row: MarketRow }
  | {
      kind: "group";
      key: string;
      groupSlug: string;
      groupTitle: string;
      children: MarketRow[];
      categories: string[];
      expiration: string | null;
      favorite: { label: string; price: number } | null;
      resolved: boolean;
      resolvedOutcome: string | null;
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
    const singles: MarketRow[] = [];
    for (const r of matched) {
      if (!r.group_slug) {
        singles.push(r);
        continue;
      }
      const g = groups.get(r.group_slug);
      if (g) g.push(r);
      else groups.set(r.group_slug, [r]);
    }

    const list: Entry[] = singles.map((row) => ({ kind: "single", key: row.slug, row }));
    for (const [groupSlug, children] of groups) {
      const fav = children
        .filter((c) => c.last_price != null)
        .sort((a, b) => (b.last_price as number) - (a.last_price as number))[0];
      // The child that resolved Yes is the event's actual outcome.
      const won = children.find((c) => c.winning_outcome_index === 0);
      list.push({
        kind: "group",
        key: groupSlug,
        groupSlug,
        groupTitle: groupTitleOf(children[0].title),
        children,
        categories: children[0].categories,
        expiration: children[0].expiration,
        favorite: fav ? { label: childLabelOf(fav.title), price: fav.last_price as number } : null,
        resolved: children.some((c) => c.winning_outcome),
        resolvedOutcome: won ? childLabelOf(won.title) : null,
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
          case "expiration": return e.row.expiration ? Date.parse(e.row.expiration) : -Infinity;
          case "last_price": return e.row.last_price ?? -Infinity;
        }
      } else {
        switch (sort) {
          case "title": return e.groupTitle.toLowerCase();
          case "expiration": return e.expiration ? Date.parse(e.expiration) : -Infinity;
          case "last_price": return e.favorite?.price ?? -Infinity;
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

  const statusPill = (label: string | null) =>
    label ? <span className="pill resolved">{label}</span> : <span className="pill pending">pending</span>;

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
          {entries.map((e) =>
            e.kind === "single" ? (
              <tr key={e.key}>
                <td><Link href={`/markets/${encodeURIComponent(e.row.slug)}`}>{e.row.title}</Link></td>
                <td className="muted">{e.row.categories.join(", ") || "—"}</td>
                <td>{fmtDate(e.row.expiration)}</td>
                <td className="num">{fmtPrice(e.row.last_price)}</td>
                <td>{statusPill(e.row.winning_outcome)}</td>
                <td><a href={limitlessUrl(e.row.slug)!} target="_blank" rel="noreferrer" title="Open on Limitless">↗</a></td>
              </tr>
            ) : (
              <Fragment key={e.key}>
                <tr className="group-row" onClick={() => setOpen((s) => {
                  const n = new Set(s);
                  n.has(e.key) ? n.delete(e.key) : n.add(e.key);
                  return n;
                })}>
                  <td>
                    <span className="caret">{open.has(e.key) ? "▾" : "▸"}</span> {e.groupTitle}{" "}
                    <span className="muted">({e.children.length} outcomes)</span>
                  </td>
                  <td className="muted">{e.categories.join(", ") || "—"}</td>
                  <td>{fmtDate(e.expiration)}</td>
                  <td className="num">{e.favorite ? `${e.favorite.label} ${e.favorite.price.toFixed(3)}` : "—"}</td>
                  <td>{statusPill(e.resolvedOutcome ?? (e.resolved ? "resolved" : null))}</td>
                  <td><a href={limitlessUrl(e.groupSlug)!} target="_blank" rel="noreferrer" title="Open on Limitless" onClick={(ev) => ev.stopPropagation()}>↗</a></td>
                </tr>
                {open.has(e.key) &&
                  e.children.map((c) => (
                    <tr key={c.slug} className="child-row">
                      <td className="indent"><Link href={`/markets/${encodeURIComponent(c.slug)}`}>{childLabelOf(c.title)}</Link></td>
                      <td />
                      <td />
                      <td className="num">{fmtPrice(c.last_price)}</td>
                      <td>
                        {c.winning_outcome_index === 0 ? (
                          <span className="pill resolved">won</span>
                        ) : c.winning_outcome ? (
                          <span className="pill pending">lost</span>
                        ) : (
                          <span className="pill pending">—</span>
                        )}
                      </td>
                      <td><a href={limitlessUrl(c.slug)!} target="_blank" rel="noreferrer">↗</a></td>
                    </tr>
                  ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </>
  );
}
