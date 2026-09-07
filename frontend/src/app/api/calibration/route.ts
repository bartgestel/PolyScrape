import { NextRequest, NextResponse } from "next/server";
import { getCalibration } from "@/lib/queries";
import type { MarketTypeFilter } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") || null;
  const hours = Number(sp.get("hoursBeforeExpiration") ?? 24);
  const mt = sp.get("marketType");
  const marketType: MarketTypeFilter = mt === "standalone" || mt === "group" ? mt : "all";
  return NextResponse.json(await getCalibration(category, hours, marketType));
}
