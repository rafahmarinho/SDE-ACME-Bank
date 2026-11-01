"use client";

/** Fallback for unexpected rendering errors: a generic message and the server log reference only. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="loading-page">
      <h1>Something went wrong</h1>
      <p className="muted">
        Please try again.{error.digest ? ` Reference: ${error.digest}` : ""}
      </p>
      <button className="text-link" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
