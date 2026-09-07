import { NextRequest, NextResponse } from "next/server";
import { getMarkets } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  return NextResponse.json(await getMarkets(category || null));
}
