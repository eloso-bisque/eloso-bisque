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
        {children}
      </body>
    </html>
  );
}
