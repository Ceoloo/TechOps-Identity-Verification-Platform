import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

const AuthContext = createContext(null);

function decodeToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[0]));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { userId: payload.sub, businessId: payload.business_id, role: payload.role, email: payload.email };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const t = getToken();
    return t ? decodeToken(t) : null;
  });

  useEffect(() => {
    // Drop an expired token on load.
    const t = getToken();
    if (t && !decodeToken(t)) {
      setToken(null);
      setUser(null);
    }
  }, []);

  async function login(email, password) {
    const res = await api.post('/api/auth/login', { email, password }, { auth: false });
    setToken(res.token);
    setUser(decodeToken(res.token));
    return res;
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
