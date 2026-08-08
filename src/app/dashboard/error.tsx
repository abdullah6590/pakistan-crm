"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the dashboard error
    console.error("Dashboard Error Boundary caught:", error);
  }, [error]);

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <Card className="max-w-md w-full border-red-100 dark:border-red-900/50">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-500 p-3 rounded-full">
              <AlertTriangle className="h-8 w-8" />
            </div>
          </div>
          <CardTitle className="text-xl">Component Failure</CardTitle>
          <CardDescription>
            A section of the dashboard failed to load.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          <div className="text-sm bg-gray-50 dark:bg-gray-900 text-gray-500 p-3 rounded-md w-full text-center truncate">
            {error.message || "Unknown error occurred"}
          </div>
          <Button onClick={() => reset()} className="w-full sm:w-auto" variant="outline">
            <RefreshCcw className="mr-2 h-4 w-4" /> Try Again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
