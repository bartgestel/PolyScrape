import { NextRequest, NextResponse } from "next/server";
import { getMarkets } from "@/lib/queries";
import { isCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  if (!isCategory(category)) {
    return NextResponse.json({ error: "category must be sports|weather" }, { status: 400 });
  }
  return NextResponse.json(await getMarkets(category));
}
