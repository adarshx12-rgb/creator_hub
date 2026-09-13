export function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="aspect-video animate-pulse bg-surface-raised" />
          <div className="space-y-2 p-3.5">
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-surface-raised" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-surface-raised" />
          </div>
        </div>
      ))}
    </div>
  );
}
