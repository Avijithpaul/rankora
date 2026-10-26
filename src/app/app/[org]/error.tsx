"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <ErrorState
        description={
          <>
            {error.message?.startsWith("You do not have permission") ? error.message : "We couldn't load this page."}
            {error.digest && <span className="mt-1 block text-xs">Reference: {error.digest}</span>}
          </>
        }
        action={
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      />
    </Card>
  );
}
