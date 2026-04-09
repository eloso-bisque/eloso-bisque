export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="bg-bisque-800 text-bisque-50 px-6 py-4 flex items-center gap-6 shadow-md">
        <span className="text-xl font-bold tracking-tight">eloso bisque</span>
        <nav className="flex gap-4 text-sm font-medium">
          <a href="/" className="hover:text-bisque-200 transition-colors">
            Dashboard
          </a>
          <a href="/contacts" className="hover:text-bisque-200 transition-colors">
            Contacts
          </a>
          <a href="/funnel" className="hover:text-bisque-200 transition-colors">
            Funnel
          </a>
          <a href="/outreach" className="hover:text-bisque-200 transition-colors">
            Outreach
          </a>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </>
  );
}
