import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const API_BASE = 'http://localhost/RiceGuard/api';

const AdvisoryManagement = () => {
  const { token } = useAuth();
  const [detections, setDetections] = useState([]);
  const [farmers, setFarmers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(null); // detection being composed for
  const [draftText, setDraftText] = useState('');
  const [adminPrompt, setAdminPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMeta, setAiMeta] = useState(null);
  const [selectedFarmers, setSelectedFarmers] = useState([]);
  const [sendResult, setSendResult] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [detectRes, farmerRes] = await Promise.all([
          fetch(`${API_BASE}/get_detections.php`, { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch(`${API_BASE}/farmer.php?action=list`, { headers: { 'Authorization': `Bearer ${token}` } }),
        ]);
        const detectData = await detectRes.json();
        const farmerData = await farmerRes.json();
        
        if (detectData.data) setDetections(detectData.data);
        if (farmerData.farmers) setFarmers(farmerData.farmers);
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [token]);

  const handleAICompose = async (detection) => {
    setAiLoading(true);
    setAiMeta(null);
    try {
      const res = await fetch(`${API_BASE}/send_advisory.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          action: 'ai_compose',
          disease: detection.disease,
          severity: detection.severity,
          admin_prompt: adminPrompt,
          location_text: `Brgy. ${detection.barangay || ''}, ${detection.municipality || ''}`,
          latitude: detection.latitude,
          longitude: detection.longitude,
        })
      });
      const data = await res.json();
      if (!data.error) {
        setDraftText(data.draft);
        setAiMeta({
          isFallback: Boolean(data.is_fallback),
          model: data.model,
          provider: data.provider,
          warning: data.warning,
        });
      }
    } catch (err) {
      console.error('AI compose failed:', err);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSend = async () => {
    if (!composing || !draftText.trim() || selectedFarmers.length === 0) {
      alert('Pumili ng farmer at lagyan ng advice text.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/send_advisory.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          action: 'send',
          farmer_ids: selectedFarmers,
          disease: composing.disease,
          severity: composing.severity,
          advice_text: draftText,
          location_text: `Brgy. ${composing.barangay || ''}, ${composing.municipality || ''}`,
          latitude: composing.latitude,
          longitude: composing.longitude,
          detection_id: composing.id,
          ai_generated: true,
          website_url: 'http://localhost:5173/farmer/map',
        })
      });
      const data = await res.json();
      setSendResult(data);
      if (!data.error) {
        setComposing(null);
        setDraftText('');
        setAdminPrompt('');
        setSelectedFarmers([]);
      }
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const toggleFarmer = (id) => {
    setSelectedFarmers(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  const selectAllFarmers = () => {
    if (selectedFarmers.length === farmers.length) {
      setSelectedFarmers([]);
    } else {
      setSelectedFarmers(farmers.map(f => f.id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-on-surface tracking-tight">Advisory Management</h2>
          <p className="text-on-surface-variant text-sm mt-1">Compose, review, and send SMS advisories to farmers. Use AI to generate drafts.</p>
        </div>
      </div>

      {/* Success Message */}
      {sendResult && !sendResult.error && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-green-600">check_circle</span>
          <div>
            <p className="font-bold text-green-800">Advisory na-send na!</p>
            <p className="text-sm text-green-600">{sendResult.results?.length || 0} farmer(s) ang nakatanggap ng SMS.</p>
          </div>
          <button onClick={() => setSendResult(null)} className="ml-auto text-green-600 hover:text-green-800">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}

      {/* PENDING DETECTIONS */}
      <section className="bg-surface-container rounded-xl border border-outline-variant/5 overflow-hidden">
        <div className="p-6 border-b border-outline-variant/10">
          <h3 className="text-lg font-semibold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-error">warning</span>
            Mga Na-detect na Sakit ({detections.length})
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">I-click ang "Compose Advisory" para gumawa ng payo at ipadala bilang SMS.</p>
        </div>

        {detections.length === 0 ? (
          <div className="p-12 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">satellite_alt</span>
            <p className="font-bold text-on-surface-variant">Walang detections</p>
            <p className="text-sm text-on-surface-variant/60">Mag-upload ng drone scan muna para makakita ng results dito.</p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/5">
            {detections.map((det, idx) => (
              <div key={det.id || idx} className="p-6 hover:bg-surface-container-high/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${det.severity === 'High' ? 'bg-error' : det.severity === 'Medium' ? 'bg-tertiary' : 'bg-primary'}`}></div>
                    <div>
                      <p className="font-bold text-on-surface">{det.disease}</p>
                      <p className="text-xs text-on-surface-variant">Severity: {det.severity} | Coords: {det.latitude}, {det.longitude}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setComposing(det);
                      setDraftText('');
                      setAdminPrompt('');
                      setAiMeta(null);
                      setSelectedFarmers([]);
                      setSendResult(null);
                    }}
                    className="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-bold hover:brightness-110 transition-all flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">edit_note</span>
                    Compose Advisory
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* COMPOSE PANEL */}
      {composing && (
        <section className="bg-surface-container-lowest rounded-xl border-2 border-primary/30 shadow-xl overflow-hidden">
          <div className="p-6 bg-primary/5 border-b border-primary/10">
            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">edit_note</span>
              Compose Advisory para sa: <span className="text-primary">{composing.disease}</span>
            </h3>
            <p className="text-xs text-on-surface-variant mt-1">
              Lokasyon: {composing.latitude}, {composing.longitude} | Severity: {composing.severity}
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Admin custom prompt for AI */}
            <div>
              <label className="block text-sm font-bold text-on-surface mb-2">
                <span className="material-symbols-outlined text-sm align-middle mr-1">smart_toy</span>
                Custom na Instruksyon para sa AI (optional)
              </label>
              <input
                type="text"
                value={adminPrompt}
                onChange={(e) => setAdminPrompt(e.target.value)}
                placeholder="Hal: Sabihin sa farmer na mag-check din ng drainage kasi umulan kahapon..."
                className="w-full px-4 py-3 border border-outline-variant/30 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none"
              />
              <button
                onClick={() => handleAICompose(composing)}
                disabled={aiLoading}
                className="mt-3 bg-[#1A4A2A] text-white px-6 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-sm">{aiLoading ? 'hourglass_empty' : 'smart_toy'}</span>
                {aiLoading ? 'Generating...' : 'Generate AI Draft'}
              </button>
            </div>

            {/* AI Loading Animation */}
            {aiLoading && (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg animate-pulse flex items-start gap-3">
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
              <div className={`rounded-lg border px-4 py-3 text-xs ${aiMeta.isFallback ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                {aiMeta.isFallback
                  ? `Fallback advisory ito. ${aiMeta.warning || 'Hindi nakaabot sa configured AI model.'}`
                  : `Live advisory mula sa ${aiMeta.model || 'configured AI model'} via ${aiMeta.provider || 'configured AI provider'}.`}
              </div>
            )}

            {/* Advisory Text Editor */}
            {!aiLoading && (
              <div>
                <label className="block text-sm font-bold text-on-surface mb-2">
                  <span className="material-symbols-outlined text-sm align-middle mr-1">description</span>
                  Advisory Text (i-edit kung kailangan)
                </label>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={8}
                  placeholder="I-type o i-generate ang payo dito..."
                  className="w-full px-4 py-3 border border-outline-variant/30 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none resize-y font-mono"
                />
              </div>
            )}

            {/* SMS Preview */}
            {draftText && (
              <div className="bg-stone-900 rounded-xl overflow-hidden shadow-lg border border-white/10">
                <div className="bg-stone-800/50 px-4 py-2 border-b border-white/5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-stone-400 text-sm">smartphone</span>
                  <span className="text-[11px] font-mono text-stone-300 uppercase tracking-widest">SMS Preview</span>
                </div>
                <div className="p-4 font-mono text-white text-xs leading-relaxed whitespace-pre-wrap">
                  [RiceGuard AI] ALERTO: {composing.disease} ({composing.severity}) na-detect sa {composing.latitude}, {composing.longitude}.{'\n\n'}
                  Payo: {draftText.substring(0, 200)}{draftText.length > 200 ? '...' : ''}{'\n\n'}
                  Detalye: http://localhost:5173/farmer/map{'\n\n'}
                  — RiceGuard AI / PhilRice
                </div>
              </div>
            )}

            {/* Select Farmers */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-bold text-on-surface flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">group</span>
                  Pumili ng Farmers na Tatanggap
                </label>
                <button onClick={selectAllFarmers} className="text-xs text-primary font-bold hover:underline">
                  {selectedFarmers.length === farmers.length ? 'I-deselect Lahat' : 'Piliin Lahat'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {farmers.map(f => (
                  <label key={f.id} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${selectedFarmers.includes(f.id) ? 'bg-primary/10 border border-primary/30' : 'bg-surface-container-high/50 border border-transparent hover:bg-surface-container-high'}`}>
                    <input
                      type="checkbox"
                      checked={selectedFarmers.includes(f.id)}
                      onChange={() => toggleFarmer(f.id)}
                      className="accent-primary w-4 h-4"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">{f.full_name}</p>
                      <p className="text-[10px] text-on-surface-variant truncate">{f.phone}</p>
                    </div>
                  </label>
                ))}
                {farmers.length === 0 && (
                  <p className="text-sm text-on-surface-variant col-span-full text-center py-4">Walang registered farmers.</p>
                )}
              </div>
            </div>

            {/* Send Button */}
            <div className="flex items-center justify-between pt-4 border-t border-outline-variant/10">
              <button
                onClick={() => { setComposing(null); setDraftText(''); setAdminPrompt(''); setAiMeta(null); }}
                className="text-on-surface-variant text-sm font-bold hover:text-error transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !draftText.trim() || selectedFarmers.length === 0}
                className="bg-primary text-on-primary px-8 py-3 rounded-lg font-extrabold text-sm uppercase tracking-widest shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">{sending ? 'hourglass_empty' : 'send'}</span>
                {sending ? 'Sending...' : `Send Advisory (${selectedFarmers.length} farmers)`}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default AdvisoryManagement;
