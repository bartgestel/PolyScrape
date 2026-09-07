"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/markets", label: "Markets" },
  { href: "/calibration", label: "Calibration" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="top">
      <span className="brand">PolyScrape</span>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
          {l.label}
        </Link>
      ))}
      <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
        Limitless Exchange · read-only
      </span>
    </nav>
  );
}
