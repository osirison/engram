'use client';

import * as React from 'react';

/**
 * The "viewing as" data-owner (`userId`) shared across the dashboard.
 *
 * The console is an operator tool: every signed-in operator can switch which
 * data owner's memories they inspect. The selection persists in localStorage so
 * it survives reloads, and seeds from a server-provided default on first paint.
 */

interface UserScopeValue {
  userId: string;
  setUserId: (userId: string) => void;
}

const STORAGE_KEY = 'engram:view-user';
const UserScopeContext = React.createContext<UserScopeValue | null>(null);

export function UserScopeProvider({
  initialUserId,
  children,
}: {
  initialUserId: string;
  children: React.ReactNode;
}) {
  const [userId, setUserIdState] = React.useState(initialUserId);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && stored !== userId) {
        // Hydrate the persisted selection after mount; doing it in an effect
        // (rather than a lazy initializer) avoids an SSR/CSR hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUserIdState(stored);
      }
    } catch {
      // localStorage unavailable (private mode) — keep the server default.
    }
    // Only on mount: hydrate from storage once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setUserId = React.useCallback((next: string) => {
    setUserIdState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore persistence failures
    }
  }, []);

  const value = React.useMemo(() => ({ userId, setUserId }), [userId, setUserId]);

  return <UserScopeContext.Provider value={value}>{children}</UserScopeContext.Provider>;
}

export function useUserScope(): UserScopeValue {
  const value = React.useContext(UserScopeContext);
  if (!value) {
    throw new Error('useUserScope must be used within a UserScopeProvider');
  }
  return value;
}
