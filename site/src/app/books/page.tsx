import { getAllBooks } from "@/lib/data";
import { BooksClient } from "./BooksClient";

export const metadata = {
  title: "Books - Argus Panoptes",
  description: "Browse all challenged books tracked by Argus Panoptes",
};

export default function BooksPage() {
  const books = getAllBooks();
  return <BooksClient books={books} />;
}
