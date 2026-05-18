import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, MapPin, Bell, User, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/farmer/home", label: "Bahay", icon: Home },
  { to: "/farmer/map", label: "Mapa", icon: MapPin },
  { to: "/farmer/alerts", label: "Alerto", icon: Bell },
  { to: "/farmer/profile", label: "Ako", icon: User },
];

export function FarmerLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 11) return "Magandang umaga";
    if (h < 17) return "Magandang hapon";
    return "Magandang gabi";
  })();

  return (
    <div className="min-h-screen bg-soil-50 md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-72 md:fixed md:inset-y-0 bg-forest-900 text-forest-50 px-5 py-7">
        <div className="font-display text-2xl font-bold mb-1">RiceGuard</div>
        <div className="text-forest-100/60 text-xs mb-7">Para sa Magsasaka</div>

        <div className="bg-forest-950/40 rounded-2xl p-4 mb-6">
          <div className="text-xs text-forest-100/60">Mabuhay,</div>
          <div className="font-semibold text-lg leading-tight">
            {profile?.full_name?.split(" ")[0] ?? "Magsasaka"}
          </div>
          {profile?.barangay && (
            <div className="text-xs text-forest-100/60 mt-1">
              {profile.barangay}, {profile.municipality}
            </div>
          )}
        </div>

        <nav className="space-y-1 flex-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-3 tap text-base font-medium transition ${
                  isActive
                    ? "bg-rice-400 text-forest-950"
                    : "text-forest-50 hover:bg-forest-950/40"
                }`
              }
            >
              <Icon size={22} />
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/farmer/notifications"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-4 py-3 tap text-base font-medium transition ${
                isActive
                  ? "bg-rice-400 text-forest-950"
                  : "text-forest-50 hover:bg-forest-950/40"
              }`
            }
          >
            <Bell size={22} />
            Mga Notipikasyon
          </NavLink>
        </nav>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 rounded-xl px-4 py-3 tap text-base font-medium text-forest-100/80 hover:bg-forest-950/40 transition"
        >
          <LogOut size={20} />
          Mag-logout
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 md:ml-72 pb-24 md:pb-8">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 bg-forest-900 text-forest-50 px-5 py-4 shadow-sm">
          <div className="text-xs text-forest-100/60">{greeting},</div>
          <div className="font-semibold text-lg leading-tight">
            {profile?.full_name?.split(" ")[0] ?? "Magsasaka"}
          </div>
        </div>

        <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-stone-200 grid grid-cols-4"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center tap gap-1 text-xs ${
                isActive ? "text-forest-800" : "text-stone-500"
              }`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
