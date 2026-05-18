import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  FileText,
  Users,
  Map as MapIcon,
  Activity,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/admin/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/scans", label: "Drone Scans", icon: Upload },
  { to: "/admin/advisories", label: "Advisories", icon: FileText },
  { to: "/admin/farmers", label: "Farmers", icon: Users },
  { to: "/admin/map", label: "Field Map", icon: MapIcon },
  { to: "/admin/model", label: "AI Model", icon: Activity },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-stone-100 lg:flex">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-forest-950 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={24} />
          </button>
          <div className="font-display font-bold text-lg">RiceGuard · Admin</div>
        </div>
        <div className="text-xs text-emerald-200">Online</div>
      </header>

      {/* Sidebar (desktop persistent, mobile drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-forest-950 text-white flex-col transition-transform lg:translate-x-0 lg:flex ${
          open ? "translate-x-0 flex" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-6 py-6">
          <div>
            <div className="font-display text-xl font-bold">RiceGuard</div>
            <div className="text-emerald-300/70 text-xs">Admin Console</div>
          </div>
          <button
            className="lg:hidden text-white"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={22} />
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-emerald-700/30 text-emerald-100 border border-emerald-700/40"
                    : "text-emerald-100/70 hover:bg-emerald-900/40 hover:text-emerald-100"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-emerald-900/40">
          <div className="text-xs text-emerald-300/60 px-3 mb-2">
            Signed in as {profile?.full_name ?? "Admin"}
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-100/70 hover:bg-emerald-900/40 hover:text-emerald-100 transition"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      <main className="flex-1 lg:ml-72 px-4 lg:px-8 py-6 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
