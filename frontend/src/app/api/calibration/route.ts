import { NextRequest, NextResponse } from "next/server";
import { getCalibration } from "@/lib/queries";
import { isCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category");
  if (!isCategory(category)) {
    return NextResponse.json({ error: "category must be sports|weather" }, { status: 400 });
  }
  const hours = Number(sp.get("hoursBeforeResolution") ?? 24);
  return NextResponse.json(await getCalibration(category, hours));
}
