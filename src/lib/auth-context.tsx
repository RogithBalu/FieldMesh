import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError, NetworkError, onConnectivity, setAuthToken, type Role, type User } from './api';
import { loadServerConfig, onServerConfigChange } from './config';
import { getDeviceId } from './device';
import { loadNames, rememberName } from './names';

const TOKEN_KEY = 'fieldmesh_token';
const USER_KEY = 'fieldmesh:user';

async function readToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return AsyncStorage.getItem(TOKEN_KEY);
  }
}
async function writeToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

export interface AuthState {
  /** True until the stored session has been checked against the server (or cache). */
  loading: boolean;
  user: User | null;
  token: string | null;
  deviceId: string | null;
  /** null = no request made yet; false = last server call failed to connect. */
  online: boolean | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; name: string; password: string; role?: Role }) => Promise<void>;
  logout: () => Promise<void>;
  /** GET /auth/me then POST /auth/refresh — re-validates and extends the session. */
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => onConnectivity(setOnline), []);

  const persistSession = useCallback(async (next: { token: string; user: User }) => {
    setAuthToken(next.token);
    setToken(next.token);
    setUser(next.user);
    rememberName(next.user.id, next.user.name);
    await Promise.all([writeToken(next.token), AsyncStorage.setItem(USER_KEY, JSON.stringify(next.user))]);
  }, []);

  const clearSession = useCallback(async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await Promise.all([writeToken(null), AsyncStorage.removeItem(USER_KEY)]);
  }, []);

  /**
   * Validates a stored token with GET /auth/me. A 401 means the token is dead
   * (server restarted with a new secret, user removed) → sign out. A network
   * failure keeps the cached user so the app still opens offline.
   */
  const validate = useCallback(
    async (storedToken: string): Promise<boolean> => {
      setAuthToken(storedToken);
      try {
        const { user: me } = await api.me();
        // Extend the session while we're online; keep the old token if refresh fails.
        let fresh = storedToken;
        try {
          fresh = (await api.refresh()).token;
        } catch {
          /* non-fatal */
        }
        await persistSession({ token: fresh, user: me });
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await clearSession();
          return false;
        }
        if (e instanceof NetworkError) {
          const cached = await AsyncStorage.getItem(USER_KEY);
          if (cached) {
            setToken(storedToken);
            setUser(JSON.parse(cached));
            return true;
          }
        }
        await clearSession();
        return false;
      }
    },
    [persistSession, clearSession]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([loadServerConfig(), loadNames()]);
      const id = await getDeviceId();
      if (cancelled) return;
      setDeviceId(id);
      const stored = await readToken();
      if (stored) await validate(stored);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [validate]);

  // Switching servers (Mesh → join another session) invalidates the session:
  // tokens are signed by a specific server.
  useEffect(
    () =>
      onServerConfigChange(() => {
        readToken().then((t) => {
          if (t) validate(t);
        });
      }),
    [validate]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email: email.trim().toLowerCase(), password });
      await persistSession(res);
    },
    [persistSession]
  );

  const signup = useCallback(
    async (input: { email: string; name: string; password: string; role?: Role }) => {
      const res = await api.signup({ ...input, email: input.email.trim().toLowerCase(), name: input.name.trim() });
      await persistSession(res);
    },
    [persistSession]
  );

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const refreshSession = useCallback(async () => {
    const stored = await readToken();
    if (!stored) return false;
    return validate(stored);
  }, [validate]);

  const value = useMemo<AuthState>(
    () => ({ loading, user, token, deviceId, online, login, signup, logout, refreshSession }),
    [loading, user, token, deviceId, online, login, signup, logout, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
