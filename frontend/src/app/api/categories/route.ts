import { NextResponse } from "next/server";
import { getCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCategories());
}
