import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionResponseSchema, type SessionResponse } from '@cravecart/contracts';
import { api, ApiError, refresh, setCsrf } from '../api';

interface SessionContextValue {
  session: SessionResponse | null | undefined;
  loading: boolean;
  error: Error | null;
  accept: (session: SessionResponse) => void;
  reload: () => Promise<unknown>;
  logout: () => Promise<void>;
}
const SessionContext = createContext<SessionContextValue | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Missing session provider');
  return value;
}
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        let result: unknown;
        try {
          result = await api('/auth/me');
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
          await refresh();
          result = await api('/auth/me');
        }
        const session = sessionResponseSchema.parse(result);
        setCsrf(session.csrfToken);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setCsrf('');
          return null;
        }
        throw error;
      }
    },
    retry: false,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const accept = useCallback(
    (value: SessionResponse) => {
      setCsrf(value.csrfToken);
      client.removeQueries({
        predicate: (q) => q.queryKey[0] !== 'session' && q.queryKey[0] !== 'platform',
      });
      client.setQueryData(['session'], value);
    },
    [client],
  );
  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    setCsrf('');
    client.removeQueries({
      predicate: (q) => q.queryKey[0] !== 'session' && q.queryKey[0] !== 'platform',
    });
    client.setQueryData(['session'], null);
  }, [client]);
  return (
    <SessionContext.Provider
      value={{
        session: query.data,
        loading: query.isPending,
        error: query.error,
        accept,
        reload: query.refetch,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
