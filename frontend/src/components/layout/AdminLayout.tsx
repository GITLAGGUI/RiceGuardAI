import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  Bell,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/admin/overview",  label: "Overview",   icon: LayoutDashboard },
  { to: "/admin/scans",     label: "Drone Scans", icon: Upload },
  { to: "/admin/advisories",label: "Advisories", icon: FileText },
  { to: "/admin/farmers",   label: "Members",    icon: Users },
  { to: "/admin/map",       label: "Field Map",  icon: MapIcon },
  { to: "/admin/model",     label: "AI Model",   icon: Activity },
  { to: "/admin/settings",  label: "Settings",   icon: Settings },
];

function pageTitle(path: string): string {
  const found = NAV.find((n) => path.startsWith(n.to));
  if (found) return found.label;
  if (path.includes("/admin/scans/new")) return "New Scan";
  if (path.includes("/admin/advisories/")) return "Compose Advisory";
  return "Admin";
}

export function AdminLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const initials = (profile?.full_name ?? "Admin")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const title = pageTitle(location.pathname);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 lg:flex">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-slate-950 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-slate-300">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 grid place-items-center text-emerald-400">
              <ShieldCheck size={16} />
            </div>
            <div className="font-display font-bold text-base">RiceGuard <span className="text-emerald-400">·</span> Admin</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900 border-r border-slate-800 flex-col transition-transform lg:translate-x-0 lg:flex ${
          open ? "translate-x-0 flex" : "-translate-x-full"
        }`}
      >
        {/* Brand block */}
        <div className="px-5 py-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 grid place-items-center text-emerald-400 ring-1 ring-emerald-500/20">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="font-display text-lg font-bold leading-tight">RiceGuard</div>
              <div className="text-emerald-400 text-[11px] uppercase tracking-widest font-semibold">
                Admin Console
              </div>
            </div>
          </div>
          <button
            className="lg:hidden text-slate-400 hover:text-slate-200"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* System status pill */}
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-semibold">
            System
          </div>
          <div className="space-y-1.5 text-xs">
            <StatusRow label="Supabase" ok />
            <StatusRow label="Ollama AI" ok />
            <StatusRow label="SMS Gate" ok />
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              end={to === "/admin/overview"}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} className={isActive ? "text-emerald-400" : ""} />
                  <span>{label}</span>
                  {isActive && (
                    <ChevronRight size={14} className="ml-auto text-emerald-400/60" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User pill */}
        <div className="px-3 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-2 mb-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-950 grid place-items-center text-xs font-bold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-100 truncate">
                {profile?.full_name ?? "Admin"}
              </div>
              <div className="text-[11px] text-slate-500 truncate">{profile?.phone}</div>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 transition"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 lg:ml-72 bg-slate-100 text-slate-900 min-h-screen">
        {/* Desktop top bar */}
        <header className="hidden lg:flex sticky top-0 z-30 bg-white border-b border-slate-200 px-8 py-3.5 items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="text-slate-400">Admin</span>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="text-slate-900 font-semibold">{title}</span>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-xs text-slate-500 font-mono">
              {now.toLocaleString("en-PH", {
                weekday: "short",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              All systems normal
            </div>
            <button className="relative text-slate-500 hover:text-slate-900 transition">
              <Bell size={18} />
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-950 grid place-items-center text-xs font-bold">
              {initials}
            </div>
          </div>
        </header>

        <div className="px-4 lg:px-8 py-6 lg:py-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-slate-300">
      <span className="text-slate-400">{label}</span>
      <span className={`flex items-center gap-1.5 ${ok ? "text-emerald-400" : "text-rose-400"}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400"}`} />
        {ok ? "Online" : "Down"}
      </span>
    </div>
  );
}
