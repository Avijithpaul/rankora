"use client";

/**
 * Last-resort error page (errors in the root layout). Shows no internal details;
 * the digest lets support find the server log entry.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0, background: "#f8fafc", color: "#0f172a" }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#475569", margin: "0 0 16px" }}>Rankora could not load this page. Please try again.</p>
          {error.digest && <p style={{ fontSize: 12, color: "#64748b" }}>Reference: {error.digest}</p>}
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
