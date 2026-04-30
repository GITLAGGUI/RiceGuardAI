import { useState, useEffect } from 'react';
import { Sliders, BellRing, ShieldCheck, Save, RotateCcw } from 'lucide-react';

const SystemSettings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const defaultSettings = {
    system_name: "RiceGuard AI Core v4",
    environment: "PRODUCTION",
    sms_username: "SOLRZV",
    sms_password: "2l8vi5achfxx5c"
  };

  const [settings, setSettings] = useState(defaultSettings);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost/RiceGuard/api/system_settings.php', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success && data.settings) {
        setSettings(data.settings);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost/RiceGuard/api/system_settings.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      
      if (data.success) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to save settings.' });
      }
    } catch (error) {
      console.error("Save error:", error);
      setMessage({ type: 'error', text: 'Network error occurred.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleReset = () => {
    setSettings(defaultSettings);
    setMessage({ type: 'success', text: 'Settings reset to defaults. Click Save to apply.' });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24 relative">
      <div className="mb-8">
        <h2 className="text-3xl font-extrabold text-[#E8F5E8] tracking-tight mb-1">System Settings</h2>
        <p className="text-on-surface-variant text-sm">Configure system integrations, notifications, and model parameters.</p>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      <div className="flex gap-8">
        {/* Left Tabs */}
        <nav className="w-64 flex flex-col gap-1 shrink-0">
          <button 
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-[13px] transition-colors ${activeTab === 'general' ? 'bg-surface-container text-primary' : 'text-on-surface-variant hover:bg-surface-container/50'}`}
          >
            <Sliders size={20} /> General
          </button>
          <button 
            onClick={() => setActiveTab('notifications')}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-[13px] transition-colors ${activeTab === 'notifications' ? 'bg-surface-container text-primary' : 'text-on-surface-variant hover:bg-surface-container/50'}`}
          >
            <BellRing size={20} /> Notifications
          </button>
        </nav>

        {/* Right Content */}
        <div className="flex-1 max-w-4xl">
          {activeTab === 'general' && (
            <section className="bg-surface-container-low p-6 rounded-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
              <h3 className="text-[12px] uppercase tracking-wider text-on-surface-variant font-bold mb-6 flex items-center gap-2">
                System Information
              </h3>
              <div className="grid grid-cols-2 gap-y-6 gap-x-12">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase text-on-surface-variant/60 block font-bold">System Name</label>
                  <input 
                    type="text" 
                    name="system_name"
                    value={settings.system_name} 
                    onChange={handleChange}
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-4 py-2.5 text-[13px] text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase text-on-surface-variant/60 block font-bold">Environment</label>
                  <select 
                    name="environment"
                    value={settings.environment}
                    onChange={handleChange}
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-4 py-2.5 text-[13px] text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all appearance-none"
                  >
                    <option value="DEVELOPMENT">DEVELOPMENT</option>
                    <option value="STAGING">STAGING</option>
                    <option value="PRODUCTION">PRODUCTION</option>
                  </select>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'notifications' && (
            <section className="bg-surface-container-low p-6 rounded-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
              <h3 className="text-[12px] uppercase tracking-wider text-on-surface-variant font-bold flex items-center gap-2 mb-6">
                SMS Notification Settings
              </h3>
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="space-y-2">
                  <label className="text-[11px] text-on-surface-variant font-bold uppercase tracking-wider">SMS Username</label>
                  <input 
                    type="text" 
                    name="sms_username"
                    value={settings.sms_username} 
                    onChange={handleChange}
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-4 py-2.5 text-[13px] text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] text-on-surface-variant font-bold uppercase tracking-wider">SMS Password / API Key</label>
                  <input 
                    type="password" 
                    name="sms_password"
                    value={settings.sms_password} 
                    onChange={handleChange}
                    className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-4 py-2.5 text-[13px] text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all" 
                  />
                </div>
              </div>
              <p className="text-xs text-on-surface-variant/70 italic">
                These credentials are used to connect to the SMS-Gate.app 3rd-party API.
              </p>
            </section>
          )}
        </div>
      </div>

      {/* Floating Bottom Bar */}
      <div className="fixed bottom-0 right-0 left-[250px] h-20 bg-surface/95 backdrop-blur-xl border-t border-outline-variant/20 px-10 flex items-center justify-between z-40">
        <button 
          onClick={handleReset}
          className="flex items-center gap-2 text-on-surface hover:text-error font-semibold text-[13px] transition-colors px-4 py-2 rounded-md hover:bg-error/10"
        >
          <RotateCcw size={18} /> Reset to Defaults
        </button>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-2.5 rounded-lg text-[13px] font-extrabold shadow-lg hover:shadow-xl transition-all flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          ) : (
            <Save size={18} />
          )}
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

export default SystemSettings;
