import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { FullPageSpinner, RequireAuth, RequireRole } from '@/components/layout/Guards';
import { NotFoundPage } from '@/components/layout/NotFound';
import { useAuth } from '@/features/auth/AuthContext';
import { homePath, isApprover } from '@/features/auth/permissions';
import LoginPage from '@/features/auth/LoginPage';
import MyClaimsPage from '@/features/claims/MyClaimsPage';
import NewClaimPage from '@/features/claims/NewClaimPage';
import ClaimEditorPage from '@/features/claims/ClaimEditorPage';
import ClaimDetailPage from '@/features/claims/ClaimDetailPage';
import InboxPage from '@/features/approvals/InboxPage';
import HomePage from '@/features/home/HomePage';

// Less frequently used / heavier screens are code-split.
const DelegationPage = lazy(() => import('@/features/approvals/DelegationPage'));
const AuditorQueuePage = lazy(() => import('@/features/auditor/AuditorQueuePage'));
const PayoutsPage = lazy(() => import('@/features/payouts/PayoutsPage'));
const PayoutDetailPage = lazy(() => import('@/features/payouts/PayoutDetailPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const AuditTrailPage = lazy(() => import('@/features/audit/AuditTrailPage'));
const PolicyRulesPage = lazy(() => import('@/features/policies/PolicyRulesPage'));

function HomeRedirect() {
  const { me } = useAuth();
  return <Navigate to={homePath(me)} replace />;
}

const Lazy = ({ children }: { children: ReactNode }) => <Suspense fallback={<FullPageSpinner />}>{children}</Suspense>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route path="/home" element={<HomePage />} />

          {/* S2 — claims (every role can own claims) */}
          <Route path="/claims" element={<MyClaimsPage />} />
          <Route path="/claims/new" element={<NewClaimPage />} />
          <Route path="/claims/:id/edit" element={<ClaimEditorPage />} />
          <Route path="/claims/:id" element={<ClaimDetailPage />} />

          {/* S3 — approvals */}
          <Route
            path="/inbox"
            element={
              <RequireRole allow={isApprover}>
                <InboxPage />
              </RequireRole>
            }
          />
          <Route
            path="/settings/delegation"
            element={
              <RequireRole allow={['MANAGER', 'AUDITOR', 'FINANCE_HEAD']}>
                <Lazy>
                  <DelegationPage />
                </Lazy>
              </RequireRole>
            }
          />

          {/* S4 — auditor */}
          <Route
            path="/auditor"
            element={
              <RequireRole allow={['AUDITOR', 'FINANCE_HEAD']}>
                <Lazy>
                  <AuditorQueuePage />
                </Lazy>
              </RequireRole>
            }
          />

          {/* S5 — payouts */}
          <Route
            path="/payouts"
            element={
              <RequireRole allow={['FINANCE_HEAD']}>
                <Lazy>
                  <PayoutsPage />
                </Lazy>
              </RequireRole>
            }
          />
          <Route
            path="/payouts/:id"
            element={
              <RequireRole allow={['FINANCE_HEAD']}>
                <Lazy>
                  <PayoutDetailPage />
                </Lazy>
              </RequireRole>
            }
          />

          {/* S6–S8 */}
          <Route
            path="/dashboard"
            element={
              <RequireRole allow={['MANAGER', 'AUDITOR', 'FINANCE_HEAD']}>
                <Lazy>
                  <DashboardPage />
                </Lazy>
              </RequireRole>
            }
          />
          <Route
            path="/audit"
            element={
              <RequireRole allow={['AUDITOR', 'FINANCE_HEAD']}>
                <Lazy>
                  <AuditTrailPage />
                </Lazy>
              </RequireRole>
            }
          />
          <Route
            path="/admin/policies"
            element={
              <RequireRole allow={['AUDITOR', 'FINANCE_HEAD']}>
                <Lazy>
                  <PolicyRulesPage />
                </Lazy>
              </RequireRole>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
