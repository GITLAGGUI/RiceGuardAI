import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/types/database";

interface Props {
  role?: UserRole;
}

export function ProtectedRoute({ role }: Props) {
  const { session, profile, loading, profileLoading } = useAuth();
  const location = useLocation();

  // Initial session restore.
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-stone-500">
        <div className="animate-pulse">Naglo-load…</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Session ready but profile fetch still in flight — wait, don't redirect
  // prematurely to /register.
  if (profileLoading && profile === null) {
    return (
      <div className="min-h-screen grid place-items-center text-stone-500">
        <div className="animate-pulse">Inihahanda ang dashboard…</div>
      </div>
    );
  }

  // A profile row exists for every auth user (auto-created by handle_new_user
  // trigger) but it starts blank. We treat profiles missing required fields
  // as "needs completion" and bounce to /register.
  if (!profile || !profile.full_name) {
    return <Navigate to="/register" replace />;
  }

  if (role && profile.role !== role) {
    const home = profile.role === "admin" ? "/admin/overview" : "/farmer/home";
    return <Navigate to={home} replace />;
  }

  return <Outlet />;
}
