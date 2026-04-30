import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const API_BASE = 'http://localhost/RiceGuard/api';

const SystemOverview = () => {
  const { token } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_BASE}/dashboard_stats.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.error) setStats(data.data);
      } catch (err) {
        console.error('Failed to fetch admin stats:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [token]);

  const farmerCount = stats?.farmer_count ?? 0;
  const scanCount = stats?.scan_count_month ?? 0;
  const detectionCount = stats?.detection_count ?? 0;
  const smsCount = stats?.sms_count ?? 0;
  const advisoryCount = stats?.advisory_count ?? 0;
  const recentScans = stats?.recent_scans ?? [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="pt-8 px-8 pb-12 w-full max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-2xl font-bold text-on-surface tracking-tight">System Overview</h2>
          <p className="text-sm text-on-surface-variant">
            RiceGuard AI — Live monitoring across all fields. <span className="text-primary font-medium italic">Season: {new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}.</span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-primary-container/10 px-3 py-1.5 rounded-full border border-primary-container/20">
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse"></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">All Services Online</span>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/60 font-semibold">Last Updated</p>
            <p className="text-sm font-bold text-on-surface">{new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        </div>
      </div>

      {/* Top KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-surface-container rounded-xl p-5 border border-outline-variant/5">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] uppercase tracking-wider text-on-surface-variant font-medium">Fields Registered</p>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-primary">{farmerCount}</p>
              <p className="text-[10px] text-on-surface-variant/70 mt-1">Active Farmers</p>
            </div>
          </div>
        </div>

        <div className="bg-surface-container rounded-xl p-5 border border-outline-variant/5">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] uppercase tracking-wider text-on-surface-variant font-medium">Farmers</p>
            <span className="material-symbols-outlined text-on-surface-variant text-sm">group</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-on-surface">{farmerCount}</p>
              <p className="text-[10px] text-secondary font-medium mt-1">{farmerCount > 0 ? 'Active' : 'Wala pa'}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface-container rounded-xl p-5 border border-outline-variant/5">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] uppercase tracking-wider text-on-surface-variant font-medium">Scans This Month</p>
            <span className="material-symbols-outlined text-sm text-on-surface-variant">precision_manufacturing</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-primary">{scanCount}</p>
              <p className="text-[10px] text-on-surface-variant/70 mt-1">Drone Feeds</p>
            </div>
          </div>
        </div>

        <div className="bg-surface-container rounded-xl p-5 border border-outline-variant/5">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] uppercase tracking-wider text-on-surface-variant font-medium">Detections</p>
            <span className="material-symbols-outlined text-error text-sm">warning</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold text-error">{detectionCount}</p>
              <p className="text-[10px] text-error/70 mt-1">{detectionCount > 0 ? 'Needs attention' : 'Clear'}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface-container rounded-xl p-5 border border-outline-variant/5">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] uppercase tracking-wider text-on-surface-variant font-medium">Advisories Sent</p>
            <span className="material-symbols-outlined text-on-surface-variant text-sm">send</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xl font-bold text-on-surface">{smsCount} <span className="text-[10px] font-normal text-on-surface-variant">SMS</span></p>
              <p className="text-xl font-bold text-on-surface">{advisoryCount} <span className="text-[10px] font-normal text-on-surface-variant">Advisory</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6 mb-8">
        <div className="col-span-12 lg:col-span-5 bg-surface-container rounded-xl p-6 border border-outline-variant/5 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface">Disease Detection Summary</h3>
          </div>
          <div className="flex-1 space-y-3">
            {(stats?.disease_breakdown || []).length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-on-surface-variant text-sm">Wala pang data ng detection.</p>
              </div>
            ) : (
              (stats?.disease_breakdown || []).map((d, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-surface-container-high/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${d.severity === 'High' ? 'bg-error' : d.severity === 'Medium' ? 'bg-tertiary' : 'bg-primary'}`}></div>
                    <span className="text-sm font-bold text-on-surface">{d.disease}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${d.severity === 'High' ? 'bg-error-container text-on-error-container' : d.severity === 'Medium' ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-primary-container text-on-primary-container'}`}>
                      {d.severity}
                    </span>
                    <span className="text-sm font-bold text-on-surface">{d.count}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 bg-surface-container rounded-xl p-6 border border-outline-variant/5">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface">Recent Scan Activity</h3>
            <a href="/admin/scans" className="text-[10px] text-primary font-bold uppercase tracking-wider hover:underline">View All</a>
          </div>
          <div className="space-y-4">
            {recentScans.length === 0 ? (
              <p className="text-sm text-on-surface-variant text-center py-8">Wala pang scans.</p>
            ) : (
              recentScans.map((scan, idx) => (
                <div key={scan.id || idx} className="group flex items-center justify-between p-3 rounded-lg hover:bg-surface-container-high transition-colors">
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-on-surface">SC-{String(scan.id).padStart(5, '0')}</p>
                    <p className="text-[10px] text-on-surface-variant">{scan.detection_count} detections</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                      scan.status === 'completed' ? 'bg-primary-container text-on-primary-container' :
                      scan.status === 'failed' ? 'bg-error-container text-on-error-container' :
                      'bg-tertiary-container text-on-tertiary-container'
                    }`}>{scan.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 bg-surface-container rounded-xl p-6 border border-outline-variant/5">
          <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface mb-6">System Health</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-on-surface-variant font-medium">YOLOv8-seg Engine</span>
              <span className="text-[10px] font-bold text-primary">OPERATIONAL</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-on-surface-variant font-medium">MySQL DB</span>
              <span className="text-[10px] font-bold text-primary">OPERATIONAL</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-on-surface-variant font-medium">SMS-Gate.app API</span>
              <span className="text-[10px] font-bold text-primary">CONNECTED</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-on-surface-variant font-medium">Ollama AI (Qwen)</span>
              <span className="text-[10px] font-bold text-primary">CONNECTED</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemOverview;
