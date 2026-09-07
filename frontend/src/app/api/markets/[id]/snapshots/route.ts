import { NextResponse } from "next/server";
import { getMarketSnapshots } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getMarketSnapshots(decodeURIComponent(id));
  if (!result) return NextResponse.json({ error: "market not found" }, { status: 404 });
  return NextResponse.json(result);
}
