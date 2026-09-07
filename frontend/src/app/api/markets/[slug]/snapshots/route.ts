import { NextResponse } from "next/server";
import { getMarketSnapshots } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const snapshots = await getMarketSnapshots(decodeURIComponent(slug));
  if (!snapshots) return NextResponse.json({ error: "market not found" }, { status: 404 });
  return NextResponse.json({ slug: decodeURIComponent(slug), snapshots });
}
