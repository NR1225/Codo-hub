import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { apiService } from '../utils/api';

interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  bio?: string;
  totp_enabled?: boolean;
}

interface AuthTokens {
  access_token: string;
  token_type: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  login: (tokens: AuthTokens, user: User) => void;
  logout: () => Promise<void>;
  setTokens: (tokens: AuthTokens) => void;
  setUser: (user: User) => void;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token refresh interval: every 5 minutes (access token expires in 30 min)
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// Retry interval for soft failures (CSRF/network)
const RETRY_INTERVAL_MS = 30 * 1000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshing = useRef(false);
  const refreshPromise = useRef<Promise<string | null> | null>(null);
  // Track the timestamp of the last successful login
  const lastLoginTime = useRef<number>(0);

  // Initialize from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        setUserState(JSON.parse(storedUser));
      } catch { /* ignore */ }
      // Only try to refresh if there's a stored user — skip for guests
      refreshAccessToken();
    } else {
      // No stored user → skip refresh, immediately mark as loaded
      setIsLoading(false);
    }
  }, []);

  // Cleanup refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // Schedule periodic token refresh
  const scheduleRefresh = useCallback((intervalMs: number = REFRESH_INTERVAL_MS) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshAccessToken();
    }, intervalMs);
  }, []);

  const clearAuthState = useCallback(() => {
    localStorage.removeItem('user');
    setAccessToken(null);
    setUserState(null);
    lastLoginTime.current = 0;
  }, []);

  const refreshAccessToken = useCallback((): Promise<string | null> => {
    // Concurrent callers (timer + expired-token retries) share one request,
    // otherwise refresh token rotation would revoke the parallel attempts.
    if (refreshPromise.current) return refreshPromise.current;
    refreshPromise.current = doRefresh().finally(() => {
      refreshPromise.current = null;
    });
    return refreshPromise.current;
  }, []);

  // Let apiService recover from an expired access token by refreshing once
  useEffect(() => {
    apiService.setTokenRefresher(refreshAccessToken);
  }, [refreshAccessToken]);

  const doRefresh = async (): Promise<string | null> => {
    isRefreshing.current = true;
    try {
      const data = await apiService.refreshToken();
      setAccessToken(data.access_token);
      // Schedule next regular refresh on success
      scheduleRefresh(REFRESH_INTERVAL_MS);
      return data.access_token;
    } catch (error: any) {
      const errMsg = String(error?.message || '').toLowerCase();

      // Hard failure: token genuinely invalid/expired/revoked → must log out
      const isHardFailure =
        (errMsg.includes('401') &&
          !errMsg.includes('network') &&
          !errMsg.includes('failed to fetch') &&
          !errMsg.includes('err_connection')) ||
        errMsg.includes('invalid refresh token') ||
        errMsg.includes('refresh token revoked') ||
        errMsg.includes('refresh token required');

      if (isHardFailure) {
        // Session is truly dead — clear it
        clearAuthState();
      } else {
        // Soft failure: CSRF (403), network error, server down, timeout, etc.
        // Do NOT log out — just retry sooner. The user stays logged in.
        // The refresh token cookie persists, so next attempt may succeed
        // (e.g. after network reconnects or server restarts).
        scheduleRefresh(RETRY_INTERVAL_MS);
      }
      return null;
    } finally {
      isRefreshing.current = false;
      setIsLoading(false);
    }
  };

  const login = useCallback((tokens: AuthTokens, userData: User) => {
    setAccessToken(tokens.access_token);
    // Store user data in localStorage for UI display and persistence
    localStorage.setItem('user', JSON.stringify(userData));
    setUserState(userData);
    // Mark the time of this login
    lastLoginTime.current = Date.now();
    // Mark loading as complete immediately after login
    setIsLoading(false);

    // Schedule periodic refresh (every 5 minutes)
    scheduleRefresh(REFRESH_INTERVAL_MS);
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    try {
      await apiService.logout(accessToken || undefined);
    } catch { /* ignore */ }
    setAccessToken(null);
    localStorage.removeItem('user');
    setUserState(null);
    lastLoginTime.current = 0;
    isRefreshing.current = false;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, [accessToken]);

  const setTokens = useCallback((tokens: AuthTokens) => {
    setAccessToken(tokens.access_token);
  }, []);

  const setUser = useCallback((userData: User) => {
    localStorage.setItem('user', JSON.stringify(userData));
    setUserState(userData);
  }, []);

  const getAccessToken = useCallback(() => accessToken, [accessToken]);

  const value: AuthContextType = {
    user,
    isAuthenticated: !isLoading && !!user && !!accessToken,
    isLoading,
    accessToken,
    login,
    logout,
    setTokens,
    setUser,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;