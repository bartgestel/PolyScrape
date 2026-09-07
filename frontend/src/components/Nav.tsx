"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/markets?category=sports", label: "Sports markets" },
  { href: "/markets?category=weather", label: "Weather markets" },
  { href: "/calibration", label: "Calibration" },
];

export default function Nav() {
  const path = usePathname();
  const sp = useSearchParams();
  const current = sp.get("category");

  return (
    <nav className="top">
      <span className="brand">PolyScrape</span>
      {links.map((l) => {
        const [base, query] = l.href.split("?");
        const active =
          base === path && (!query || query.includes(`category=${current}`));
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
