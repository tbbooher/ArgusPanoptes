import { notFound } from "next/navigation";
import { getCategories, getCategoryBooks } from "@/lib/data";
import { AUDIENCE_LABELS, TOPIC_LABELS } from "@/lib/types";
import { CategoryBooksClient } from "./CategoryBooksClient";

export async function generateStaticParams() {
  const categories = getCategories();
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const label = AUDIENCE_LABELS[slug] ?? TOPIC_LABELS[slug] ?? slug;
  return {
    title: `${label} - Argus Panoptes`,
  };
}

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const label = AUDIENCE_LABELS[slug] ?? TOPIC_LABELS[slug];
  if (!label) notFound();

  const books = getCategoryBooks(slug);
  const isAudience = slug in AUDIENCE_LABELS;

  return (
    <CategoryBooksClient
      label={label}
      books={books}
      isAudience={isAudience}
    />
  );
}
