import { NextRequest, NextResponse } from "next/server";
import { getCalibration } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") || null;
  const hours = Number(sp.get("hoursBeforeExpiration") ?? 24);
  return NextResponse.json(await getCalibration(category, hours));
}
