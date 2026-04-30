import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * ProtectedRoute - guards routes that require authentication.
 * 
 * Props:
 *   requireAdmin - if true, also checks for admin role
 *   children     - the wrapped component
 */
const ProtectedRoute = ({ children, requireAdmin = false }) => {
  const { isAuthenticated, isLoading, farmer } = useAuth();
  const location = useLocation();

  // Show nothing while checking auth (prevents flash)
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-on-surface-variant text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in → redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Requires admin but user is not admin
  if (requireAdmin && farmer?.role !== 'admin') {
    return <Navigate to="/farmer/home" replace />;
  }

  return children;
};

export default ProtectedRoute;
