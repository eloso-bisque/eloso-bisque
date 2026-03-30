import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eloso Bisque",
  description: "CRM & Sales Funnel powered by Kissinger",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bisque-50 text-bisque-950">
        <header className="bg-bisque-800 text-bisque-50 px-6 py-4 flex items-center gap-6 shadow-md">
          <span className="text-xl font-bold tracking-tight">eloso bisque</span>
          <nav className="flex gap-4 text-sm font-medium">
            <a
              href="/"
              className="hover:text-bisque-200 transition-colors"
            >
              Dashboard
            </a>
            <a
              href="/contacts"
              className="hover:text-bisque-200 transition-colors"
            >
              Contacts
            </a>
            <a
              href="/funnel"
              className="hover:text-bisque-200 transition-colors"
            >
              Funnel
            </a>
          </nav>
        </header>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
