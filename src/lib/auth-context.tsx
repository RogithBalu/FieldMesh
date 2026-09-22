import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as db from './localdb';
import { getDeviceId } from './device';

const SESSION_KEY = 'fieldmesh_session_user_id';

interface AuthState {
  loading: boolean;
  user: db.PublicUser | null;
  deviceId: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; name: string; password: string; role?: db.User['role'] }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<db.PublicUser | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setDeviceId(await getDeviceId());
      const savedUserId = await SecureStore.getItemAsync(SESSION_KEY);
      if (savedUserId) {
        const found = await db.getUser(savedUserId);
        if (found) setUser(found);
        else await SecureStore.deleteItemAsync(SESSION_KEY);
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await db.login(email, password);
    await SecureStore.setItemAsync(SESSION_KEY, u.id);
    setUser(u);
  }, []);

  const signup = useCallback(
    async (input: { email: string; name: string; password: string; role?: db.User['role'] }) => {
      const u = await db.signup(input);
      await SecureStore.setItemAsync(SESSION_KEY, u.id);
      setUser(u);
    },
    []
  );

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ loading, user, deviceId, login, signup, logout }),
    [loading, user, deviceId, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
