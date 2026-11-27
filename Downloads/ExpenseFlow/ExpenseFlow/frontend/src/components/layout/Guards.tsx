import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Me, Role } from '@/api/types';
import { useAuth } from '@/features/auth/AuthContext';
import { hasRole, homePath } from '@/features/auth/permissions';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, PageSkeleton } from '@/components/ui/Display';

export function FullPageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="w-full px-4 py-6 md:px-6 lg:px-8">
      <PageSkeleton label={label} />
    </div>
  );
}

/** Requires a token and a resolved `/me`; otherwise redirects to /login. */
export function RequireAuth() {
  const { token, me, loading, error, logout } = useAuth();
  const location = useLocation();

  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (loading) return <FullPageSpinner label="Signing you in…" />;
  if (!me) {
    return (
      <div className="mx-auto mt-16 max-w-md space-y-3 px-4">
        <ErrorBanner error={error} />
        <Button variant="primary" onClick={logout} testId="back-to-login">
          Back to sign-in
        </Button>
      </div>
    );
  }
  return <Outlet />;
}

/**
 * Role guard. Users without the role are redirected to their home page.
 * `allow` can be roles or a predicate (e.g. "approver or active delegate").
 */
export function RequireRole({ allow, children }: { allow: Role[] | ((me: Me) => boolean); children: ReactNode }) {
  const { me } = useAuth();
  if (!me) return null;
  const ok = typeof allow === 'function' ? allow(me) : hasRole(me, ...allow);
  if (!ok) {
    const home = homePath(me);
    return <Navigate to={home === window.location.pathname ? '/claims' : home} replace />;
  }
  return <>{children}</>;
}
