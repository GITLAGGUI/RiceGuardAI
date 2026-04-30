import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const API_BASE = 'http://localhost/RiceGuard/api';

const FarmerManagement = () => {
  const { token } = useAuth();
  const [message, setMessage] = useState('');
  const [farmers, setFarmers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiMeta, setAiMeta] = useState(null);

  useEffect(() => {
    const fetchFarmers = async () => {
      try {
        const res = await fetch(`${API_BASE}/farmer.php?action=list`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.farmers) setFarmers(data.farmers);
      } catch (err) {
        console.error('Failed to fetch farmers:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchFarmers();
  }, [token]);

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    setAiDraft('');
    setAiMeta(null);
    try {
      const res = await fetch(`${API_BASE}/ai_chat.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ prompt: aiPrompt })
      });
      const data = await res.json();
      if (data.draft) {
        setAiDraft(data.draft);
        setAiMeta({
          isFallback: Boolean(data.is_fallback),
          model: data.model,
          provider: data.provider,
          warning: data.warning,
        });
      }
    } catch (err) {
      console.error('Failed to generate AI draft:', err);
      alert('Error connecting to AI Server.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAcceptDraft = () => {
    setMessage(aiDraft);
    setAiDraft('');
    setAiPrompt('');
    setAiMeta(null);
  };

  const handleCancelDraft = () => {
    setAiDraft('');
    setAiMeta(null);
  };

  const sendSms = async () => {
    if (!message.trim()) return;
    setSendingBulk(true);
    setBulkResult(null);

    try {
      const response = await fetch(`${API_BASE}/sms.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'send_advisory',
          message: message,
          recipients: farmers.map(f => f.phone)
        })
      });
      const data = await response.json();
      setBulkResult({ success: true, message: `Na-send na sa ${farmers.length} farmers.` });
      setMessage('');
    } catch (error) {
      console.error('Failed to send SMS', error);
      setBulkResult({ success: false, message: 'Hindi na-send ang SMS.' });
    } finally {
      setSendingBulk(false);
    }
  };

  return (
    <div className="p-8 pb-12 w-full max-w-7xl mx-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-extrabold text-on-surface tracking-tight">Farmer Management</h2>
          <p className="text-on-surface-variant text-sm mt-1">Registered farmers and their field assignments.</p>
        </div>
      </div>

      {/* Bulk Result Banner */}
      {bulkResult && (
        <div className={`p-4 rounded-xl flex items-center gap-3 mb-6 ${bulkResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <span className={`material-symbols-outlined ${bulkResult.success ? 'text-green-600' : 'text-red-600'}`}>
            {bulkResult.success ? 'check_circle' : 'error'}
          </span>
          <p className={`text-sm font-bold ${bulkResult.success ? 'text-green-800' : 'text-red-800'}`}>{bulkResult.message}</p>
          <button onClick={() => setBulkResult(null)} className="ml-auto">
            <span className="material-symbols-outlined text-on-surface-variant text-sm">close</span>
          </button>
        </div>
      )}

      <div className="bg-surface-container rounded-xl overflow-hidden mb-8">
        <div className="p-6 border-b border-outline-variant/5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-on-surface uppercase tracking-wider">Farmer Directory ({farmers.length})</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : farmers.length === 0 ? (
          <div className="p-12 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">person_off</span>
            <p className="font-bold text-on-surface-variant">Walang registered farmers</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50">
                <tr>
                  <th className="p-4 text-[10px] uppercase font-medium text-on-surface-variant/70">Farmer Name</th>
                  <th className="p-4 text-[10px] uppercase font-medium text-on-surface-variant/70">Contact Number</th>
                  <th className="p-4 text-[10px] uppercase font-medium text-on-surface-variant/70">Location</th>
                  <th className="p-4 text-[10px] uppercase font-medium text-on-surface-variant/70">Farm Size</th>
                  <th className="p-4 text-[10px] uppercase font-medium text-on-surface-variant/70 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/5">
                {farmers.map(farmer => {
                  const location = [farmer.barangay, farmer.municipality, farmer.province].filter(Boolean).join(', ');
                  return (
                    <tr key={farmer.id} className="hover:bg-surface-container-high/40 transition-colors">
                      <td className="p-4 text-[13px] font-semibold">{farmer.full_name}</td>
                      <td className="p-4 text-[13px] text-on-surface-variant font-mono">{farmer.phone}</td>
                      <td className="p-4 text-[13px] text-on-surface-variant">{location || '—'}</td>
                      <td className="p-4 text-[13px] text-on-surface-variant">{farmer.farm_size ? `${farmer.farm_size} ha` : '—'}</td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${farmer.is_active ? 'bg-primary-container/20 text-primary' : 'bg-error-container/20 text-error'}`}>
                          {farmer.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk Notification Component */}
      <div className="bg-surface-container rounded-xl flex flex-col border border-outline-variant/10">
        <div className="p-6 border-b border-outline-variant/5">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary">sms</span>
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">Bulk Notification</h3>
          </div>
          <p className="text-[11px] text-on-surface-variant">Send urgent advisories or field maintenance reminders to all registered farmers.</p>
        </div>
        <div className="p-6 flex flex-col gap-6">
          
          {/* AI Generation Section */}
          <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/20">
            <label className="block text-xs font-bold text-on-surface mb-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] text-primary">smart_toy</span>
              Tanungin ang RiceGuard AI Expert
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Halimbawa: Gumawa ng paalala tungkol sa paparating na ulan at sakit sa palay..."
                className="flex-1 px-4 py-2 text-sm bg-surface-container-lowest border border-outline-variant/10 rounded-lg focus:ring-1 focus:ring-primary outline-none"
              />
              <button
                onClick={handleAiGenerate}
                disabled={isAiLoading || !aiPrompt.trim()}
                className="bg-primary/20 text-primary px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/30 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {isAiLoading ? (
                  <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                ) : (
                  <span className="material-symbols-outlined text-sm">auto_awesome</span>
                )}
                Generate
              </button>
            </div>

            {/* AI Loading Animation */}
            {isAiLoading && (
              <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg animate-pulse flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5 animate-spin">autorenew</span>
                <div className="flex-1 space-y-2 mt-1">
                  <div className="h-2.5 bg-primary/20 rounded w-1/4"></div>
                  <div className="h-2.5 bg-primary/10 rounded w-full"></div>
                  <div className="h-2.5 bg-primary/10 rounded w-5/6"></div>
                  <p className="text-[10px] text-primary/60 font-bold pt-2 uppercase tracking-widest">RiceGuard AI is thinking...</p>
                </div>
              </div>
            )}

            {aiMeta && (
              <div className={`mt-4 rounded-lg border px-4 py-3 text-xs ${aiMeta.isFallback ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                {aiMeta.isFallback
                  ? `Fallback advisory lang ito. ${aiMeta.warning || 'Hindi nakaabot sa configured AI model.'}`
                  : `Live response mula sa ${aiMeta.model || 'configured AI model'} via ${aiMeta.provider || 'configured AI provider'}.`}
              </div>
            )}

            {/* AI Draft Review */}
            {!isAiLoading && aiDraft && (
              <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <p className="text-[11px] uppercase tracking-widest text-primary font-bold mb-2">AI Generated Draft:</p>
                <p className="text-sm text-on-surface italic mb-4">{aiDraft}</p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={handleCancelDraft}
                    className="px-4 py-1.5 text-xs font-bold text-on-surface-variant hover:text-error transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAcceptDraft}
                    className="bg-emerald-600 text-white px-4 py-1.5 rounded-md text-xs font-bold shadow-md hover:bg-emerald-700 transition-all flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">check</span>
                    Accept & Use
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SMS Textarea */}
          <div className="space-y-2 mt-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full h-32 bg-surface-container-lowest border border-outline-variant/10 rounded-lg p-4 text-[13px] text-on-surface focus:ring-1 focus:ring-primary outline-none resize-none"
              placeholder="Enter notification message here, or use the AI generator above..."
            ></textarea>
          </div>
          
          <button
            onClick={sendSms}
            disabled={sendingBulk || !message.trim() || farmers.length === 0}
            className="w-full bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold py-3 rounded-lg hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">{sendingBulk ? 'hourglass_empty' : 'send'}</span>
            {sendingBulk ? 'Sending...' : `Send via SMS-Gate.app (${farmers.length} farmers)`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FarmerManagement;
