import { Card, CardContent } from "@/components/ui/card";

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* KPI cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted" />
              <div className="flex-1">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-6 w-24 rounded bg-muted mt-1.5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts skeleton */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="h-5 w-32 rounded bg-muted mb-4" />
            <div className="h-48 w-full rounded bg-muted" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="h-5 w-32 rounded bg-muted mb-4" />
            <div className="h-48 w-full rounded bg-muted" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
