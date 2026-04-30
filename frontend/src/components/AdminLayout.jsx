import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AdminLayout = () => {
  const { farmer, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const adminName = farmer?.full_name?.split(' ')[0] || 'Admin';

  const navItems = [
    { name: 'Overview', path: '/admin/overview', icon: 'dashboard' },
    { name: 'Disease Map', path: '/admin/map', icon: 'map' },
    { name: 'Scan Management', path: '/admin/scans', icon: 'document_scanner' },
    { name: 'Advisory Management', path: '/admin/advisories', icon: 'send' },
    { name: 'Farmers', path: '/admin/farmers', icon: 'group' },
    { name: 'Model Performance', path: '/admin/performance', icon: 'analytics' },
    { name: 'System Settings', path: '/admin/settings', icon: 'settings' },
  ];

  return (
    <div className="bg-surface text-on-surface selection:bg-primary/30 min-h-screen flex">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-[240px] bg-[#021108] flex flex-col py-6 px-4 z-50">
        <div className="mb-10 px-2 flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/20 rounded flex items-center justify-center overflow-hidden border border-primary/30">
            <img src="/assets/logo.png" alt="RiceGuard Logo" className="w-full h-full object-cover p-1" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#E8F5E8] tracking-tighter">RiceGuard AI</h1>
            <p className="text-[10px] uppercase tracking-widest text-[#76E153] font-semibold mt-1">Admin</p>
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 py-2.5 px-4 rounded-lg transition-colors duration-200 ${
                  isActive
                    ? 'text-[#76E153] font-semibold border-r-2 border-[#76E153] bg-[#112318] scale-[0.98]'
                    : 'text-[#E8F5E8]/60 hover:text-[#E8F5E8] hover:bg-[#112318]'
                }`
              }
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span className="text-[13px]">{item.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-outline-variant/10 px-2 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center text-white font-bold text-sm">
            {adminName.charAt(0).toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-bold truncate text-white">{adminName}</p>
            <p className="text-[10px] text-[#76E153] uppercase tracking-tight">Admin</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <NavLink
            to="/farmer/home"
            className="flex items-center gap-2 text-[10px] font-bold text-[#76E153] hover:text-white transition-colors uppercase tracking-widest px-2"
          >
            <span className="material-symbols-outlined text-sm">swap_horiz</span>
            Switch to Farmer Portal
          </NavLink>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase tracking-widest px-2 py-2 mt-1 w-full text-left"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
            Log Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="ml-[240px] flex-1 flex flex-col min-h-screen">
        {/* Top Navbar */}
        <header className="fixed top-0 right-0 w-[calc(100%-240px)] h-16 bg-[#05170C]/80 backdrop-blur-md flex items-center justify-between px-8 z-40 border-b border-white/5">
          <div className="flex items-center gap-4 bg-surface-container-lowest px-4 py-1.5 rounded-full border border-outline-variant/10 w-96 focus-within:ring-1 focus-within:ring-[#76E153] transition-all">
            <span className="material-symbols-outlined text-on-surface-variant text-sm">search</span>
            <input
              type="text"
              placeholder="Search parameters or logs..."
              className="bg-transparent border-none outline-none focus:ring-0 text-sm w-full placeholder:text-on-surface-variant/50 text-on-surface"
            />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#76E153]">System Online</span>
              <span className="w-2 h-2 bg-[#4fdbcc] rounded-full animate-pulse shadow-[0_0_8px_rgba(79,219,204,0.6)]"></span>
            </div>
            <div className="h-6 w-px bg-outline-variant/20"></div>
            <button className="relative text-[#E8F5E8]/70 hover:text-[#76E153] transition-all">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-0 right-0 w-2 h-2 bg-[#76E153] rounded-full border border-[#05170C]"></span>
            </button>
          </div>
        </header>

        {/* Content Canvas */}
        <div className="flex-1 bg-surface-container-low pt-20 pb-8 px-6 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
