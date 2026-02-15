import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SearchPalette } from "@/components/search/SearchPalette";
import "./globals.css";

export const metadata: Metadata = {
  title: "Argus Panoptes - Texas Library Holdings Report",
  description:
    "Interactive report on challenged book holdings across 260+ Texas public library systems",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-950 font-sans text-gray-100 antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark">
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <SearchPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
