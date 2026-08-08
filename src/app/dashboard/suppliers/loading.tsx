import { Card, CardContent } from "@/components/ui/card";

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted" />
          <div>
            <div className="h-6 w-28 rounded bg-muted" />
            <div className="h-4 w-52 rounded bg-muted mt-1.5" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 rounded bg-muted" />
          <div className="h-9 w-28 rounded bg-muted" />
        </div>
      </div>

      {/* Stats cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-muted" />
              <div>
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-6 w-16 rounded bg-muted mt-1.5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table skeleton */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="h-9 w-64 rounded bg-muted" />
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-12 w-full rounded bg-muted" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
