import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { checkAuth, logout as apiLogout } from '../services/api';

const AuthContext = createContext(null);

/**
 * AuthProvider - wraps the app, provides global auth state.
 * 
 * On mount:
 *   1. Checks localStorage for cached farmer data (instant UI)
 *   2. Validates token with the server in background
 *   3. If invalid, clears state and redirects
 */
export function AuthProvider({ children }) {
  const [farmer, setFarmer] = useState(() => {
    try {
      const cached = localStorage.getItem('rg_farmer');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!farmer;

  // Validate token on mount
  useEffect(() => {
    const token = localStorage.getItem('rg_token');
    if (!token) {
      setFarmer(null);
      setIsLoading(false);
      return;
    }

    checkAuth()
      .then((data) => {
        if (data.authenticated && data.farmer) {
          setFarmer(data.farmer);
          localStorage.setItem('rg_farmer', JSON.stringify(data.farmer));
        } else {
          setFarmer(null);
          localStorage.removeItem('rg_token');
          localStorage.removeItem('rg_farmer');
        }
      })
      .catch(() => {
        // Token invalid or server error — keep cached data for now
        // If it's a 401, the api.js already cleared localStorage
        const stillHasToken = localStorage.getItem('rg_token');
        if (!stillHasToken) {
          setFarmer(null);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  /**
   * Call after successful OTP verification
   */
  const login = useCallback((farmerData) => {
    setFarmer(farmerData);
    localStorage.setItem('rg_farmer', JSON.stringify(farmerData));
  }, []);

  /**
   * Logout — clear server session + local state
   */
  const logout = useCallback(async () => {
    await apiLogout();
    setFarmer(null);
  }, []);

  const token = localStorage.getItem('rg_token');

  const value = {
    farmer,
    token,
    isAuthenticated,
    isLoading,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
