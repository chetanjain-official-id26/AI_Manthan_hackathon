import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth';
import { setUnauthorizedHandler, tokenStore } from '@/api/client';
import { qk } from '@/api/keys';
import type { Me } from '@/api/types';

interface AuthState {
  token: string | null;
  me: Me | null;
  loading: boolean;
  error: unknown;
  login: (employeeId: number) => Promise<Me>;
  logout: () => void;
  refetchMe: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStore.get());

  const meQuery = useQuery({
    queryKey: qk.me,
    queryFn: authApi.me,
    enabled: !!token,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const logout = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    qc.clear();
  }, [qc]);

  // Sign out automatically when the JWT expires (60 min), instead of waiting for the next 401.
  useEffect(() => {
    if (!token) return;
    const exp = tokenStore.expiresAt();
    if (exp === null) return;
    const ms = Math.max(0, exp - Date.now());
    const t = window.setTimeout(() => {
      tokenStore.clear('expired');
      setToken(null);
      qc.clear();
    }, Math.min(ms, 2_147_000_000));
    return () => window.clearTimeout(t);
  }, [token, qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      qc.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const login = useCallback(
    async (employeeId: number) => {
      const res = await authApi.demoLogin(employeeId);
      qc.clear();
      tokenStore.set(res.token, res.expiresAt);
      setToken(res.token);
      // /me carries the active delegations, which the login response does not.
      try {
        const me = await qc.fetchQuery({ queryKey: qk.me, queryFn: authApi.me });
        return me;
      } catch {
        const fallback: Me = { ...res.user, activeDelegations: [] };
        qc.setQueryData(qk.me, fallback);
        return fallback;
      }
    },
    [qc],
  );

  const value = useMemo<AuthState>(
    () => ({
      token,
      me: token ? (meQuery.data ?? null) : null,
      loading: !!token && meQuery.isPending,
      error: meQuery.error,
      login,
      logout,
      refetchMe: () => void meQuery.refetch(),
    }),
    [token, meQuery, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For pages rendered behind <RequireAuth>, where `me` is guaranteed. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('useMe called outside an authenticated route');
  return me;
}
