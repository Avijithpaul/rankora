import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-brand">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page doesn&apos;t exist or you don&apos;t have access to it.</p>
        <ButtonLink href="/app" className="mt-6">
          Back to Rankora
        </ButtonLink>
      </div>
    </div>
  );
}
