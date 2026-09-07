import MarketTable from "@/components/MarketTable";
import { getCategories, getMarkets } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const cat = category ?? null;
  const [rows, categories] = await Promise.all([getMarkets(cat), getCategories()]);

  return (
    <>
      <h1>Markets{cat ? ` · ${cat}` : ""}</h1>
      <MarketTable rows={rows} categories={categories} activeCategory={cat} />
    </>
  );
}
