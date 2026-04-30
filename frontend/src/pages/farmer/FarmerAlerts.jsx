import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const API_BASE = 'http://localhost/RiceGuard/api';

const FarmerAlerts = () => {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState({ active_alerts: [], alert_history: [], advisories: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch(`${API_BASE}/get_alerts.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.error) setAlerts(data.data);
      } catch (err) {
        console.error('Failed to fetch alerts:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAlerts();
  }, [token]);

  const getSeverityConfig = (severity) => {
    if (severity === 'High') return {
      borderClass: 'border-t-4 border-error', borderL: 'border-l-4 border-l-red-500 border-red-100',
      iconBg: 'bg-red-100 text-red-600', badgeBg: 'bg-error text-on-error', dotColor: '#ef4444',
      icon: 'dangerous', label: 'HIGH'
    };
    if (severity === 'Medium') return {
      borderClass: 'border-t-4 border-tertiary', borderL: 'border-l-4 border-l-yellow-500 border-yellow-100',
      iconBg: 'bg-yellow-100 text-yellow-700', badgeBg: 'bg-tertiary text-white', dotColor: '#f97316',
      icon: 'priority_high', label: 'MODERATE'
    };
    return {
      borderClass: 'border-t-4 border-primary', borderL: 'border-l-4 border-l-green-500 border-green-100',
      iconBg: 'bg-green-100 text-green-700', badgeBg: 'bg-primary text-white', dotColor: '#22c55e',
      icon: 'check_circle', label: 'LOW'
    };
  };

  const activeAlerts = alerts.active_alerts || [];
  const alertHistory = alerts.alert_history || [];
  const advisories = alerts.advisories || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="pt-8 pb-20 px-6 max-w-7xl mx-auto space-y-12">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-[24px] font-semibold text-on-surface tracking-tight">Mga Alerto sa Sakit</h2>
          <p className="text-on-surface-variant text-sm mt-1">Real-time na deteksyon sa iyong bukid.</p>
        </div>
      </header>

      {/* ACTIVE ALERTS */}
      <section>
        <div className="flex items-center gap-2 mb-6">
          <span className="material-symbols-outlined text-error" style={{fontVariationSettings: "'FILL' 1"}}>warning</span>
          <h3 className="font-bold text-error tracking-wide uppercase text-sm">Active Alerts ({activeAlerts.length})</h3>
        </div>

        {activeAlerts.length === 0 ? (
          <div className="bg-green-50 p-8 rounded-xl text-center border border-green-200">
            <span className="material-symbols-outlined text-green-600 text-4xl mb-2">verified</span>
            <p className="font-bold text-green-800 text-lg">Walang aktibong alerto</p>
            <p className="text-sm text-green-600 mt-1">Malusog ang iyong bukid base sa pinakahuling drone scan.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {activeAlerts.map((alert, idx) => {
              const config = getSeverityConfig(alert.severity);
              return (
                <div key={alert.id || idx} className={`group bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden ${config.borderClass} flex flex-col`}>
                  <div className="p-6 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                      <div className="flex flex-col gap-2">
                        <div className={`flex items-center gap-2 ${config.iconBg.replace('bg-', 'bg-').replace('text-', 'text-')} px-3 py-1.5 rounded-full w-fit`} style={{backgroundColor: `${config.dotColor}15`, color: config.dotColor}}>
                          <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{backgroundColor: config.dotColor}}></span>
                          <span className="text-sm font-bold">{alert.disease}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className={`${config.badgeBg} text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider`}>{config.label}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[12px] text-on-surface-variant block font-medium">Lokasyon</span>
                        <span className="text-sm font-semibold text-on-surface">{alert.location_text || `${alert.latitude}, ${alert.longitude}`}</span>
                      </div>
                    </div>

                    {/* Advisory from DB if exists */}
                    {advisories.filter(a => a.disease === alert.disease).slice(0, 1).map((adv, i) => (
                      <div key={i} className="bg-surface-container-low p-4 rounded-lg mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="material-symbols-outlined text-primary text-sm">medical_services</span>
                          <h4 className="text-xs font-bold text-on-primary-fixed-variant uppercase">Advisory</h4>
                        </div>
                        <p className="text-sm text-on-surface-variant leading-relaxed">{adv.advice_text}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-surface-container-high/50 p-4 flex gap-3">
                    <a href="/farmer/notifications" className="flex-1 chlorophyll-gradient text-white text-xs font-bold py-2.5 rounded-lg text-center">Tingnan ang Buong Advisory</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* PAST ACTIVITY & SMS META */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h3 className="font-bold text-on-surface-variant text-sm uppercase tracking-widest mb-6 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">history</span> Nakaraang Aktibidad
          </h3>
          <div className="space-y-3">
            {alertHistory.length === 0 ? (
              <p className="text-sm text-on-surface-variant py-6 text-center">Wala pang nakaraang alerto.</p>
            ) : (
              alertHistory.slice(0, 5).map((hist, idx) => (
                <div key={hist.id || idx} className="bg-surface-container-low p-4 rounded-xl flex items-center justify-between group hover:bg-surface-container-high transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${hist.severity === 'High' ? 'bg-error-container' : 'bg-secondary-container'}`}>
                      <span className={`material-symbols-outlined ${hist.severity === 'High' ? 'text-error' : 'text-secondary'}`}>
                        {hist.severity === 'High' ? 'coronavirus' : 'check_circle'}
                      </span>
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">{hist.disease}</h4>
                      <p className="text-xs text-on-surface-variant">{hist.location}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-on-surface block">
                      {new Date(hist.sent_at).toLocaleDateString('fil-PH', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className={`text-[10px] font-bold uppercase ${hist.delivery_status === 'delivered' ? 'text-primary' : 'text-error'}`}>
                      {hist.delivery_status === 'delivered' ? 'Naipadala' : hist.delivery_status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-secondary-container/30 rounded-xl p-6 h-full flex flex-col">
            <h3 className="font-bold text-on-secondary-container text-sm flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined">send_to_mobile</span> Notification Meta
            </h3>
            <div className="space-y-6 flex-1">
              {alertHistory.length > 0 ? (
                <div className="flex items-start gap-4">
                  <span className="material-symbols-outlined text-primary">sms</span>
                  <div>
                    <span className="text-xs font-bold text-on-secondary-container block">SMS SENT</span>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      Naipadala noong {new Date(alertHistory[0].sent_at).toLocaleString('fil-PH')}.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4">
                  <span className="material-symbols-outlined text-on-surface-variant">sms</span>
                  <div>
                    <span className="text-xs font-bold text-on-secondary-container block">WALA PANG SMS</span>
                    <p className="text-xs text-on-surface-variant mt-0.5">Wala pang advisory na naipadala sa iyo.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FarmerAlerts;
