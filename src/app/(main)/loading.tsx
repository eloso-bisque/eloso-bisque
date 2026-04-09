export default function MainLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
      <div className="h-9 w-40 bg-bisque-200 rounded-lg animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow p-3 md:p-4 border border-bisque-100">
            <div className="h-8 w-16 bg-bisque-100 rounded animate-pulse mb-2" />
            <div className="h-4 w-20 bg-bisque-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
