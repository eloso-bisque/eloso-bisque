import MobileNav from "@/components/MobileNav";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Desktop top nav — hidden on mobile */}
      <header className="hidden md:flex bg-bisque-800 text-bisque-50 px-6 py-4 items-center gap-6 shadow-md">
        <span className="text-xl font-bold tracking-tight">eloso bisque</span>
        <nav className="flex gap-4 text-sm font-medium">
          <a href="/" className="hover:text-bisque-200 transition-colors">
            Dashboard
          </a>
          <a href="/contacts" className="hover:text-bisque-200 transition-colors">
            Contacts
          </a>
          <a href="/investors" className="hover:text-bisque-200 transition-colors">
            Investors
          </a>
          <a href="/funnel" className="hover:text-bisque-200 transition-colors">
            Funnel
          </a>
          <a href="/outreach" className="hover:text-bisque-200 transition-colors">
            Outreach
          </a>
          <a href="/sectors" className="hover:text-bisque-200 transition-colors">
            Sectors
          </a>
        </nav>
      </header>

      {/* Mobile top bar — wordmark only, shown on mobile */}
      <header className="flex md:hidden bg-bisque-800 text-bisque-50 px-4 py-3 items-center shadow-md">
        <span className="text-lg font-bold tracking-tight">eloso bisque</span>
      </header>

      {/* Main content — extra bottom padding on mobile for bottom nav */}
      <main className="p-4 md:p-6 pb-20 md:pb-6">{children}</main>

      {/* Mobile bottom tab bar — only visible on mobile */}
      <MobileNav />
    </>
  );
}
