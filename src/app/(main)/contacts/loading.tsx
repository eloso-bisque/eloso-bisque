export default function ContactsLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-9 w-36 bg-bisque-200 rounded-lg animate-pulse" />
        <div className="h-8 w-24 bg-bisque-200 rounded-lg animate-pulse" />
      </div>

      {/* Search bar skeleton */}
      <div className="flex gap-2">
        <div className="flex-1 h-10 bg-bisque-100 rounded-lg animate-pulse" />
        <div className="w-20 h-10 bg-bisque-200 rounded-lg animate-pulse" />
      </div>

      {/* Tabs skeleton */}
      <div className="flex flex-wrap gap-2">
        {["People", "VC Firms", "Prospects", "Other Orgs", "All"].map((label) => (
          <div
            key={label}
            className="h-9 w-24 bg-bisque-100 rounded-lg animate-pulse"
          />
        ))}
      </div>

      {/* Contact rows skeleton */}
      <div className="bg-white rounded-xl border border-bisque-100 overflow-hidden shadow-sm">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-b border-bisque-50"
          >
            <div className="h-5 flex-1 bg-bisque-100 rounded animate-pulse" />
            <div className="h-5 w-32 bg-bisque-100 rounded animate-pulse hidden sm:block" />
            <div className="h-5 w-24 bg-bisque-100 rounded animate-pulse hidden md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
