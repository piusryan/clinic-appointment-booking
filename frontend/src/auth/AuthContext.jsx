import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, setAccessToken, clearAccessToken, refreshAccessToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Bootstrapping: the refresh cookie survives page reloads, so we restore
  // the session (and mint a fresh access token) without ever storing it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await refreshAccessToken();
        if (ok && !cancelled) {
          const { user: me } = await authApi.me();
          if (!cancelled) setUser(me);
        }
      } catch {
        /* not signed in */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const { accessToken, user: me } = await authApi.login({ email, password });
    setAccessToken(accessToken);
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (payload) => {
    const { user: me } = await authApi.register(payload);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearAccessToken();
      setUser(null);
    }
  }, []);

  // Global expiry broadcast from the api client (refresh failed).
  useEffect(() => {
    const onExpired = () => {
      clearAccessToken();
      setUser(null);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, setUser }),
    [user, ready, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthContext;