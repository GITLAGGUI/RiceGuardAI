import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const API_BASE = 'http://localhost/RiceGuard/api';

const FarmerNotifications = () => {
  const { token, farmer } = useAuth();
  const [advisories, setAdvisories] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [latestSms, setLatestSms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('payo'); // 'payo' or 'inbox'

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch Notifications History
        const notifRes = await fetch(`${API_BASE}/get_notifications.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const notifData = await notifRes.json();
        if (!notifData.error) {
          setNotifications(notifData.data.notifications || []);
          setLatestSms(notifData.data.latest_sms || null);
        }

        // Fetch Alerts for AI Advisories
        const alertsRes = await fetch(`${API_BASE}/get_alerts.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const alertsData = await alertsRes.json();

        if (!alertsData.error && alertsData.data) {
          const activeAlerts = alertsData.data.active_alerts || [];
          const dbAdvisories = alertsData.data.advisories || [];

          if (dbAdvisories.length > 0) {
            setAdvisories(dbAdvisories.map(adv => ({
              id: adv.id,
              disease: adv.disease,
              severity: adv.severity,
              location_text: adv.location_text,
              advice: adv.advice_text,
              created_at: adv.created_at,
              is_fallback: false,
              source: 'admin',
            })));
          } else if (activeAlerts.length > 0) {
            const uniqueDiseases = [...new Map(activeAlerts.map(a => [a.disease, a])).values()];
            const locationText = farmer?.barangay ? `Brgy. ${farmer.barangay}` : '';

            const aiResults = await Promise.all(
              uniqueDiseases.map(async (alert) => {
                try {
                  const res = await fetch(`${API_BASE}/ai_expert.php`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      disease: alert.disease,
                      severity: alert.severity,
                      location_text: locationText
                    })
                  });
                  const data = await res.json();
                  return {
                    id: alert.id,
                    disease: alert.disease,
                    severity: alert.severity,
                    location_text: alert.location_text || locationText,
                    advice: data.advice || 'Kumonsulta sa agriculturist.',
                    created_at: alert.created_at,
                    is_fallback: data.is_fallback || false,
                    source: data.is_fallback ? 'philrice' : 'ai',
                  };
                } catch {
                  return {
                    id: alert.id,
                    disease: alert.disease,
                    severity: alert.severity,
                    location_text: alert.location_text || locationText,
                    advice: 'Kumonsulta sa lokal na agriculturist.',
                    created_at: alert.created_at,
                    is_fallback: true,
                    source: 'error',
                  };
                }
              })
            );
            setAdvisories(aiResults);
          }
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token, farmer]);

  const getTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 5) return 'Ngayon lang';
    if (mins < 60) return `${mins} min nakalipas`;
    if (hours < 24) return `${hours} oras nakalipas`;
    if (days < 7) return `${days} araw nakalipas`;
    return new Date(dateStr).toLocaleDateString('fil-PH', { month: 'short', day: 'numeric' });
  };

  const getSeverityStyles = (severity) => {
    if (severity === 'High' || severity === 'Kritikal') return {
      gradient: 'from-rose-500 to-red-600',
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
      icon: 'dangerous',
      shadow: 'shadow-red-500/20'
    };
    if (severity === 'Medium' || severity === 'Mataas') return {
      gradient: 'from-amber-400 to-orange-500',
      bg: 'bg-orange-50',
      text: 'text-orange-800',
      border: 'border-orange-200',
      icon: 'warning',
      shadow: 'shadow-orange-500/20'
    };
    return {
      gradient: 'from-emerald-400 to-green-600',
      bg: 'bg-green-50',
      text: 'text-green-800',
      border: 'border-green-200',
      icon: 'info',
      shadow: 'shadow-green-500/20'
    };
  };

  const formatAdvice = (text) => {
    return text.split('\n').map((line, idx) => {
      if (!line.trim()) return null;
      return (
        <li key={idx} className="flex items-start gap-4 mb-4 group">
          <div className="flex-shrink-0 w-8 h-8 mt-0.5 rounded-full bg-gradient-to-br from-[#1A4A2A] to-[#2C7A4B] flex items-center justify-center text-white font-bold shadow-md group-hover:scale-110 transition-transform">
            {idx + 1}
          </div>
          <p className="text-gray-700 text-[16px] leading-relaxed font-medium pt-1">
            {line.replace(/^([0-9]+\.|\*|\-)\s+/, '')}
          </p>
        </li>
      );
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 pb-32">
      {/* Header Section */}
      <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-gray-900 bg-clip-text text-transparent bg-gradient-to-r from-[#1A4A2A] to-[#4caf50]">
            Mga Payo at Notipikasyon
          </h1>
          <p className="text-lg text-gray-600 font-medium mt-2">
            Ang iyong sentro para sa mga aksyon at mensahe ng RiceGuard AI.
          </p>
        </div>
        
        {/* Custom Premium Tabs */}
        <div className="flex p-1 bg-gray-100/80 backdrop-blur-md rounded-2xl shadow-inner border border-gray-200/50">
          <button
            onClick={() => setActiveTab('payo')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 ${
              activeTab === 'payo'
                ? 'bg-white text-[#1A4A2A] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">assignment_turned_in</span>
            Aktibong Payo
            {advisories.length > 0 && (
              <span className="ml-1 bg-red-500 text-white px-2 py-0.5 rounded-full text-[10px]">{advisories.length}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('inbox')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 ${
              activeTab === 'inbox'
                ? 'bg-white text-[#1A4A2A] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">inbox</span>
            Inbox Mensahe
            {notifications.length > 0 && (
              <span className="ml-1 bg-[#1A4A2A] text-white px-2 py-0.5 rounded-full text-[10px]">{notifications.length}</span>
            )}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-6">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 border-4 border-green-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-[#1A4A2A] border-t-transparent rounded-full animate-spin"></div>
            <span className="absolute inset-0 flex items-center justify-center material-symbols-outlined text-[#1A4A2A] animate-pulse">smart_toy</span>
          </div>
          <p className="text-gray-600 font-bold text-lg animate-pulse">Kinukuha ang pinakabagong datos...</p>
        </div>
      ) : activeTab === 'payo' ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* AI Banner */}
          <div className="bg-gradient-to-r from-[#1A4A2A] to-[#2C7A4B] rounded-2xl p-5 flex items-center gap-4 shadow-lg shadow-green-900/10 text-white relative overflow-hidden">
            <div className="absolute right-0 top-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
            <div className="bg-white/10 p-3 rounded-xl backdrop-blur-md border border-white/20">
              <span className="material-symbols-outlined text-3xl text-green-100">psychology</span>
            </div>
            <div className="relative z-10">
              <h2 className="text-xl font-black mb-0.5">RiceGuard AI Advisory</h2>
              <p className="text-green-100/90 text-sm font-medium">Lahat ng hakbang dito ay aprubado ng PhilRice IPM Guidelines at inakma sa iyong bukid.</p>
            </div>
          </div>

          {advisories.length === 0 ? (
             <div className="bg-white rounded-3xl border border-gray-100 p-16 text-center shadow-sm">
               <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
                 <span className="material-symbols-outlined text-5xl text-green-500">verified</span>
               </div>
               <h3 className="text-2xl font-black text-gray-900 mb-2">Ligtas ang Iyong Bukid!</h3>
               <p className="text-gray-500 text-lg">Wala pang na-detect na sakit. Ipagpatuloy ang magandang pag-aalaga sa palay.</p>
             </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {advisories.map((adv) => {
                const styles = getSeverityStyles(adv.severity);
                return (
                  <div key={adv.id} className={`bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300`}>
                    {/* Card Header */}
                    <div className={`bg-gradient-to-r ${styles.gradient} p-6 sm:p-8 text-white relative overflow-hidden`}>
                      <div className="absolute right-0 bottom-0 opacity-10 translate-x-1/4 translate-y-1/4">
                        <span className="material-symbols-outlined text-[150px]">{styles.icon}</span>
                      </div>
                      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3 mb-3">
                            <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-black uppercase tracking-widest">
                              {adv.severity} Panganib
                            </span>
                            {adv.created_at && (
                              <span className="text-xs font-bold text-white/80 uppercase tracking-wider flex items-center gap-1">
                                <span className="material-symbols-outlined text-[14px]">schedule</span>
                                {getTimeAgo(adv.created_at)}
                              </span>
                            )}
                          </div>
                          <h3 className="text-3xl sm:text-4xl font-black flex items-center gap-3">
                            {adv.disease}
                          </h3>
                        </div>
                        {adv.location_text && (
                          <div className="flex items-center gap-2 bg-black/20 backdrop-blur-md px-4 py-2 rounded-xl text-sm font-bold">
                            <span className="material-symbols-outlined text-[20px]">location_on</span>
                            {adv.location_text}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-5 sm:p-6 flex flex-col h-full">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-1.5 h-5 rounded-full bg-[#1A4A2A]"></div>
                        <h4 className="text-lg font-bold text-gray-900">Mga Rekomendasyon</h4>
                      </div>
                      <ul className="space-y-1 mb-6 pl-1 flex-1">
                        {formatAdvice(adv.advice)}
                      </ul>
                      
                      <div className="flex justify-end pt-4 border-t border-gray-100 mt-auto">
                        <button className="bg-gray-900 hover:bg-black text-white px-6 py-3 rounded-xl font-bold transition-transform hover:scale-[1.02] active:scale-95 shadow-md flex items-center gap-2 w-full justify-center">
                          <span className="material-symbols-outlined text-[20px]">done_all</span>
                          Nagawa Ko Na Ito
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {notifications.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-100 p-16 text-center shadow-sm">
              <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="material-symbols-outlined text-5xl text-gray-400">notifications_off</span>
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">Walang Laman ang Inbox</h3>
              <p className="text-gray-500 text-lg">Wala pang mensahe mula sa system o sa admin.</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-100">
                {notifications.map((notif, idx) => {
                  const isSms = notif.type === 'sms';
                  const styles = getSeverityStyles(notif.severity);
                  return (
                    <div key={notif.id || idx} className="p-4 sm:p-5 hover:bg-gray-50/80 transition-colors flex flex-col md:flex-row gap-4 items-start">
                      <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${styles.gradient} text-white shadow-sm mt-1`}>
                        <span className="material-symbols-outlined text-[24px]">{isSms ? 'sms' : 'notifications_active'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <h4 className="text-lg font-bold text-gray-900 truncate max-w-full">{notif.disease}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${styles.bg} ${styles.text}`}>
                            {notif.severity}
                          </span>
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[9px] font-black uppercase tracking-widest">
                            {isSms ? 'Via SMS' : 'In-App'}
                          </span>
                        </div>
                        <p className="text-gray-500 text-xs font-medium mb-2 truncate">
                          <span className="material-symbols-outlined text-[14px] align-text-bottom mr-1">location_on</span>{notif.location}
                        </p>
                        <div className="bg-gray-50/50 border border-gray-100 rounded-lg p-3 text-gray-700 text-sm leading-relaxed font-medium">
                          {notif.advice}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right md:w-28 pt-1">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">
                          {getTimeAgo(notif.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SMS Latest Preview */}
          {latestSms && activeTab === 'inbox' && (
            <div className="mt-8 bg-[#1A4A2A] rounded-3xl p-8 shadow-xl text-white overflow-hidden relative">
              <div className="absolute right-0 top-0 opacity-10 translate-x-1/4 -translate-y-1/4">
                <span className="material-symbols-outlined text-[200px]">smartphone</span>
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
                    <span className="material-symbols-outlined">send_to_mobile</span>
                  </div>
                  <h3 className="text-lg font-bold tracking-wide">Huling SMS Record</h3>
                </div>
                <div className="font-mono bg-black/40 p-6 rounded-2xl border border-white/10 shadow-inner text-sm leading-relaxed text-green-50">
                  <span className="text-green-400">{'>'}</span> [RiceGuard AI] <span className="text-red-400 font-bold uppercase">ALERTO:</span> {latestSms.disease} ({latestSms.severity}) sa {latestSms.location}.{' '}
                  Payo: {latestSms.advice ? latestSms.advice.substring(0, 100) + '...' : ''}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FarmerNotifications;
