import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const API_BASE = 'http://localhost/RiceGuard/api';

const ScanManagement = () => {
  const { token } = useAuth();
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  useEffect(() => {
    const fetchScans = async () => {
      try {
        const res = await fetch(`${API_BASE}/dashboard_stats.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.error && data.data?.recent_scans) {
          setScans(data.data.recent_scans);
        }
      } catch (err) {
        console.error('Failed to fetch scans:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchScans();
  }, [token]);

  const handleRunInference = async () => {
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await fetch(`${API_BASE}/upload_scan.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ mock_ai: true })
      });
      const data = await res.json();
      setUploadResult(data);
      // Refresh scans
      const refreshRes = await fetch(`${API_BASE}/dashboard_stats.php`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const refreshData = await refreshRes.json();
      if (!refreshData.error && refreshData.data?.recent_scans) {
        setScans(refreshData.data.recent_scans);
      }
    } catch (e) {
      setUploadResult({ error: true, message: 'Error communicating with backend.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-8 space-y-8 flex-1 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-on-surface tracking-tight">Scan Management</h2>
          <p className="text-on-surface-variant text-sm mt-1">Upload drone imagery, run YOLOv8-seg inference, and manage scan sessions.</p>
        </div>
        <button className="bg-gradient-to-r from-primary to-primary-container text-on-primary px-5 py-2.5 rounded-lg font-bold text-sm shadow-lg hover:brightness-110 transition-all flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">add</span>
          New Scan Session
        </button>
      </div>

      {/* Upload Result Banner */}
      {uploadResult && (
        <div className={`p-4 rounded-xl flex items-center gap-3 ${uploadResult.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <span className={`material-symbols-outlined ${uploadResult.error ? 'text-red-600' : 'text-green-600'}`}>
            {uploadResult.error ? 'error' : 'check_circle'}
          </span>
          <p className={`text-sm font-bold ${uploadResult.error ? 'text-red-800' : 'text-green-800'}`}>
            {uploadResult.error ? uploadResult.message : `Scan processed. ${uploadResult.detections_count || 0} disease detections found.`}
          </p>
          <button onClick={() => setUploadResult(null)} className="ml-auto">
            <span className="material-symbols-outlined text-on-surface-variant text-sm">close</span>
          </button>
        </div>
      )}

      {/* UPLOAD PANEL */}
      <section className="bg-surface-container-low rounded-xl ghost-border overflow-hidden">
        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-on-surface">Upload Drone-Captured Images</h3>
            <p className="text-xs text-on-surface-variant mt-0.5">Drag and drop geotagged JPG/PNG images.</p>
          </div>
        </div>
        <div className="p-8">
          <div className="border-2 border-dashed border-outline-variant/30 rounded-xl bg-surface-container-lowest/50 flex flex-col items-center justify-center py-12 px-6 hover:border-primary/50 transition-colors cursor-pointer">
            <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-primary text-3xl">cloud_upload</span>
            </div>
            <p className="text-on-surface font-medium">Drop imagery folder or click to browse</p>
          </div>
          <div className="mt-8 flex justify-end">
            <button
              onClick={handleRunInference}
              disabled={uploading}
              className="bg-primary text-on-primary px-8 py-3 rounded-lg font-extrabold text-sm uppercase tracking-widest shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">{uploading ? 'hourglass_empty' : 'precision_manufacturing'}</span>
              {uploading ? 'Processing...' : 'Run YOLOv8-seg Inference'}
            </button>
          </div>
        </div>
      </section>

      {/* RECENT SCANS */}
      <section className="bg-surface-container rounded-xl ghost-border overflow-hidden">
        <div className="p-6 border-b border-outline-variant/10">
          <h3 className="text-lg font-semibold text-on-surface">Recent Scan Sessions</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : scans.length === 0 ? (
          <div className="p-12 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">satellite_alt</span>
            <p className="font-bold text-on-surface-variant">Wala pang scan sessions.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-on-surface-variant">Scan ID</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-on-surface-variant">Date</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-on-surface-variant">Detections</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-on-surface-variant">Status</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-on-surface-variant">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/5">
                {scans.map((scan, idx) => (
                  <tr key={scan.id || idx} className="hover:bg-surface-container-high transition-colors">
                    <td className="px-6 py-4 font-mono text-[12px] text-primary">SC-{String(scan.id).padStart(5, '0')}</td>
                    <td className="px-6 py-4 text-[13px] font-medium">
                      {new Date(scan.scan_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-6 py-4 text-[13px] font-bold">{scan.detection_count}</td>
                    <td className="px-6 py-4">
                      <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        scan.status === 'completed' ? 'bg-primary-container text-on-primary-container' :
                        scan.status === 'failed' ? 'bg-error-container text-on-error-container' :
                        'bg-tertiary-container text-on-tertiary-container'
                      }`}>{scan.status}</span>
                    </td>
                    <td className="px-6 py-4 text-[13px]">{scan.admin_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default ScanManagement;
