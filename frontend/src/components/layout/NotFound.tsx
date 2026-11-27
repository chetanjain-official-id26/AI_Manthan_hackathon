import { Link } from 'react-router';
import { FileQuestion } from 'lucide-react';

/** Shown for unknown routes and for any claim/receipt the caller may not see (BR-27: 404, never 403). */
export function NotFoundPage({ title = 'Page not found', message }: { title?: string; message?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center" data-testid="not-found">
      <FileQuestion className="h-12 w-12 text-slate-500" aria-hidden />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600">{message ?? 'The page you asked for does not exist or you do not have access to it.'}</p>
      <Link
        to="/"
        className="mt-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
        data-testid="not-found-home"
      >
        Go to home
      </Link>
    </div>
  );
}

export function ClaimNotFound() {
  return (
    <NotFoundPage
      title="Claim not found"
      message="This claim does not exist, or you do not have access to it."
    />
  );
}
