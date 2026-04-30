import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost/RiceGuard/api';

const FarmerLayout = () => {
  const { farmer, token, logout } = useAuth();
  const navigate = useNavigate();
  const [notifCount, setNotifCount] = useState(0);

  // Fetch notification count from DB
  useEffect(() => {
    if (!token) return;
    const fetchCount = async () => {
      try {
        const res = await fetch(`${API_BASE}/get_notifications.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.error) {
          setNotifCount(data.data.total_count || 0);
        }
      } catch (err) {
        // Silent fail — badge won't show
      }
    };
    fetchCount();
  }, [token]);

  const navItems = [
    { name: 'Aking Bukid', path: '/farmer/home', icon: 'home' },
    { name: 'Mga Alerto sa Sakit', path: '/farmer/alerts', icon: 'notifications_active' },
    { name: 'Mapa ng Bukid', path: '/farmer/map', icon: 'map' },
    { name: 'Mga Payo at Notipikasyon', path: '/farmer/notifications', icon: 'mark_email_unread', badge: notifCount },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const farmerFirstName = farmer?.full_name?.split(' ')[0] || 'Farmer';
  const farmerFullName = farmer?.full_name || 'Farmer';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Magandang Umaga';
    if (hour < 17) return 'Magandang Hapon';
    return 'Magandang Gabi';
  };

  return (
    <div className="bg-surface text-on-surface font-body min-h-screen flex">
      {/* Sidebar */}
      <nav className="fixed left-0 top-0 bottom-0 flex flex-col p-4 bg-[#1A4A2A] w-[280px] shadow-2xl z-50">
        <div className="flex items-center gap-3 mb-10 px-2 pt-2">
          <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center backdrop-blur-sm border border-white/5 overflow-hidden shadow-inner">
            <img src="/assets/logo.png" alt="RiceGuard Logo" className="w-full h-full object-cover p-1.5" />
          </div>
          <div className="flex flex-col">
            <span className="text-[24px] font-extrabold text-white tracking-tighter leading-none">RiceGuard</span>
            <span className="text-[12px] font-bold text-green-400/90 uppercase tracking-[0.2em] mt-1">Farmer Portal</span>
          </div>
        </div>

        {/* Farmer Profile Mini */}
        <div className="px-4 py-4 mb-6 bg-white/5 rounded-xl border border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-primary/30 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {farmerFirstName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-base font-semibold truncate">{farmerFullName}</p>
              <p className="text-green-300/50 text-xs truncate">{farmer?.phone || ''}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col space-y-2 mt-4">
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                `px-4 py-4 flex items-center gap-4 transition-all duration-200 ${
                  isActive
                    ? 'bg-white/10 text-white rounded-lg scale-[0.98]'
                    : 'text-green-100/70 hover:text-white hover:bg-white/5 rounded-lg'
                }`
              }
            >
              <span className="material-symbols-outlined text-[24px]">{item.icon}</span>
              <span className="text-[16px] font-bold flex-1">{item.name}</span>
              {item.badge > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[22px] text-center">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        <div className="mt-auto space-y-3">
          {/* Show Switch to Admin only for admin role */}
          {farmer?.role === 'admin' && (
            <NavLink
              to="/admin/overview"
              className="flex items-center gap-2 text-[12px] font-bold text-green-100/50 hover:text-white transition-colors uppercase tracking-widest px-2"
            >
              <span className="material-symbols-outlined text-base">swap_horiz</span>
              Switch to Admin Portal
            </NavLink>
          )}

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-300/70 hover:text-red-200 hover:bg-red-500/10 rounded-lg transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="text-[15px] font-bold">Mag-Log Out</span>
          </button>

          <button className="w-full bg-[#eab308] text-[#1A4A2A] py-4 px-4 rounded-xl text-[16px] font-extrabold shadow-lg hover:brightness-110 transition-all flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[20px]">report_problem</span>
            Mag-report ng Peste
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="ml-[280px] flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Navbar */}
        <header className="bg-surface-container-lowest shadow-sm flex justify-between items-center w-full px-8 py-5 sticky top-0 z-40 border-b border-surface-variant">
          <div className="flex items-center gap-4">
            <div className="text-[#006b29] text-xl font-extrabold">{getGreeting()}, {farmerFirstName}!</div>
          </div>
          <div className="flex items-center gap-3">
            {farmer?.province && (
              <span className="text-sm font-semibold text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined text-lg">location_on</span>
                {farmer.barangay && `${farmer.barangay}, `}{farmer.municipality && `${farmer.municipality}, `}{farmer.province}
              </span>
            )}
          </div>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default FarmerLayout;
