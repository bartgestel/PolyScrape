import { redirect } from "next/navigation";
import MarketTable from "@/components/MarketTable";
import { getMarkets } from "@/lib/queries";
import { isCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  if (!isCategory(category)) redirect("/markets?category=sports");

  const rows = await getMarkets(category);

  return (
    <>
      <h1>{category} markets</h1>
      <MarketTable category={category} rows={rows} />
    </>
  );
}
