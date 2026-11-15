import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  authGetMe,
  authGetTraverses,
  authLogin,
  authLogout,
  authRegister,
  authSaveTraverse,
} from '../services/aresApi.js';
import { toast } from '../lib/toast.js';

const AuthContext = createContext(null);
const TOKEN_KEY = 'ares_auth_token';
const USER_KEY = 'ares_auth_user';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  });

  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [traverses, setTraverses] = useState([]);
  const [loadingTraverses, setLoadingTraverses] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Sync token & profile on mount if token exists
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    authGetMe().then((profile) => {
      if (cancelled) return;
      if (profile && profile.username) {
        setUser(profile);
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(profile));
        } catch {}
      } else {
        // Token invalid or expired
        setToken(null);
        setUser(null);
        try {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        } catch {}
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Load user route history and path hazards when user is logged in
  const loadHistory = async () => {
    if (!token) {
      setTraverses([]);
      return;
    }
    setLoadingTraverses(true);
    const list = await authGetTraverses();
    if (Array.isArray(list)) {
      setTraverses(list);
    }
    setLoadingTraverses(false);
  };

  useEffect(() => {
    if (token) {
      loadHistory();
    } else {
      setTraverses([]);
    }
  }, [token]);

  const login = async (username, password) => {
    const res = await authLogin(username, password);
    if (!res || !res.access_token) {
      throw new Error(res?.detail || 'Login failed. Please check credentials.');
    }
    setToken(res.access_token);
    setUser(res.user);
    try {
      localStorage.setItem(TOKEN_KEY, res.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    } catch {}
    toast(`Welcome back, ${res.user.callsign || res.user.username}`, 'ok');
    setAuthModalOpen(false);
    return res;
  };

  const register = async (username, email, password, callsign) => {
    const res = await authRegister(username, email, password, callsign);
    if (!res || !res.access_token) {
      throw new Error(res?.detail || 'Registration failed. Check details.');
    }
    setToken(res.access_token);
    setUser(res.user);
    try {
      localStorage.setItem(TOKEN_KEY, res.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    } catch {}
    toast(`Account registered: ${res.user.callsign || res.user.username}`, 'ok');
    setAuthModalOpen(false);
    return res;
  };

  const logout = async () => {
    await authLogout();
    setToken(null);
    setUser(null);
    setTraverses([]);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
    toast('Logged out successfully', 'info');
  };

  const recordTraverse = async (traverseData) => {
    if (!token) return null;
    const res = await authSaveTraverse(traverseData);
    if (res && res.id) {
      loadHistory();
    }
    return res;
  };

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: !!token && !!user,
      authModalOpen,
      setAuthModalOpen,
      login,
      register,
      logout,
      traverses,
      loadingTraverses,
      refreshHistory: loadHistory,
      recordTraverse,
    }),
    [user, token, authModalOpen, traverses, loadingTraverses]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
