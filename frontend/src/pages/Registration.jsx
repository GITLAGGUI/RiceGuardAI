import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerFarmer } from '../services/api';

const Registration = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    province: '',
    municipality: '',
    barangay: '',
    farm_size: '',
  });

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    setError(''); // Clear error on input change
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Client-side validation
    if (!form.full_name.trim()) {
      setError('Full name is required.');
      setLoading(false);
      return;
    }
    if (!form.phone.trim()) {
      setError('Phone number is required.');
      setLoading(false);
      return;
    }
    if (!form.province.trim()) {
      setError('Province is required.');
      setLoading(false);
      return;
    }
    if (!form.municipality.trim()) {
      setError('Municipality is required.');
      setLoading(false);
      return;
    }
    if (!form.barangay.trim()) {
      setError('Barangay is required.');
      setLoading(false);
      return;
    }

    try {
      await registerFarmer({
        ...form,
        farm_size: form.farm_size ? parseFloat(form.farm_size) : null,
      });
      // Redirect to login with success indicator
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      setError(err.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-body bg-surface text-on-surface selection:bg-primary-fixed selection:text-on-primary-fixed min-h-screen relative flex items-center justify-center p-4 py-8">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuBKpt3u9niTAemZhF8CxnMg_uUTzNzJ5WIB41m7QPfk4d80mXyOUoF4tW9iGObuA_680h2WxlhqZH-EIegnJWBxx_GlFc6EarO2L1Vp6I-sZAjlgSTy1CKh_yYuDQ5-35F9d4TmXACQ-0vE4FjW1xsSbmm8guCT8FyQsjil-T1Dv7rkO1F1fdwQyaDLGA3vgEEuCXLf2jPPjoz0i3Doq-4VMdnYrUnMLRnPhmn6AGc2_3nMbF4sVJIvlSC65uZrPi9xSjyvngCvLcg" 
          alt="Rice paddy landscape" 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-on-background/40 backdrop-blur-[2px]"></div>
      </div>

      {/* Top Navigation */}
      <div className="absolute top-0 right-0 p-8 z-20">
        <Link to="/login" className="text-white font-medium text-sm flex items-center gap-2 hover:opacity-80 transition-opacity">
          Already have an account? 
          <span className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">Log in</span>
        </Link>
      </div>

      {/* Main Registration Card */}
      <main className="relative z-10 w-full max-w-[560px] bg-surface-container-lowest rounded-[2rem] shadow-[0_32px_64px_rgba(0,0,0,0.3)] overflow-hidden border border-white/10">
        
        {/* Back Button */}
        <div className="absolute top-6 left-6 z-20">
          <Link to="/login" className="flex items-center justify-center w-10 h-10 rounded-full text-outline hover:text-on-surface hover:bg-surface-container-highest transition-colors" title="Back to Login">
            <span className="material-symbols-outlined">arrow_back</span>
          </Link>
        </div>

        {/* Brand Anchor */}
        <div className="px-8 pt-10 pb-6 text-center">
          <div className="flex justify-center mb-6">
            <div className="flex items-center gap-2 text-primary">
              <span className="material-symbols-outlined text-3xl" style={{fontVariationSettings: "'FILL' 1"}}>eco</span>
              <span className="font-headline text-2xl font-bold tracking-tighter text-on-background uppercase">RiceGuard AI</span>
            </div>
          </div>
          <h1 className="font-headline text-3xl md:text-4xl text-on-background font-bold tracking-tight mb-2">Join the Future</h1>
          <p className="text-on-surface-variant text-lg">Create your free farmer account</p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mx-8 mb-4 p-4 bg-error-container/20 border border-error/20 rounded-xl flex items-start gap-3">
            <span className="material-symbols-outlined text-error text-lg mt-0.5">error</span>
            <p className="text-sm text-error font-medium">{error}</p>
          </div>
        )}

        {/* Form Section */}
        <form onSubmit={handleSubmit} className="px-8 pb-12 space-y-6">
          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-outline px-1">Full Name *</label>
            <div className="relative group">
              <input 
                className="w-full h-14 px-4 bg-surface-container-highest border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-on-background placeholder:text-outline transition-all" 
                placeholder="Juan Dela Cruz" 
                type="text"
                value={form.full_name}
                onChange={handleChange('full_name')}
                disabled={loading}
                required
              />
              <span className="absolute right-4 top-4 material-symbols-outlined text-outline group-focus-within:text-primary">person</span>
            </div>
          </div>

          {/* Phone Number */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-outline px-1">Phone Number *</label>
            <div className="relative group flex items-center bg-surface-container-highest rounded-xl focus-within:ring-2 focus-within:ring-primary/20 transition-all">
              <div className="flex items-center pl-4 pr-3 text-on-surface/80 border-r border-outline-variant/30 select-none">
                <span className="text-lg">🇵🇭</span>
                <span className="ml-2 font-bold">+63</span>
              </div>
              <input 
                className="flex-1 min-w-0 h-14 pl-3 pr-4 bg-transparent border-none outline-none text-on-background placeholder:text-outline" 
                placeholder="912 345 6789" 
                type="tel"
                value={form.phone}
                onChange={(e) => {
                  let val = e.target.value.replace(/\D/g, '');
                  if (val.startsWith('0')) {
                    val = val.replace(/^0+/, '');
                  }
                  if (val.length > 0 && val[0] !== '9') {
                    val = '';
                  }
                  setForm(prev => ({ ...prev, phone: val.slice(0, 10) }));
                  setError('');
                }}
                disabled={loading}
                required
              />
            </div>
            <p className="text-[10px] text-outline px-1">Format: 10 digits (e.g., 912 345 6789)</p>
          </div>

          {/* Province */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-outline px-1">Province *</label>
            <div className="relative group">
              <input 
                className="w-full h-14 px-4 bg-surface-container-highest border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-on-background placeholder:text-outline transition-all" 
                placeholder="Isabela" 
                type="text"
                value={form.province}
                onChange={handleChange('province')}
                disabled={loading}
                required
              />
              <span className="absolute right-4 top-4 material-symbols-outlined text-outline group-focus-within:text-primary">location_on</span>
            </div>
          </div>

          {/* Municipality + Barangay Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-outline px-1">Municipality *</label>
              <div className="relative group">
                <input 
                  className="w-full h-14 px-4 bg-surface-container-highest border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-on-background placeholder:text-outline transition-all text-sm" 
                  placeholder="Alicia" 
                  type="text"
                  value={form.municipality}
                  onChange={handleChange('municipality')}
                  disabled={loading}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-outline px-1">Barangay *</label>
              <div className="relative group">
                <input 
                  className="w-full h-14 px-4 bg-surface-container-highest border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-on-background placeholder:text-outline transition-all text-sm" 
                  placeholder="San Antonio" 
                  type="text"
                  value={form.barangay}
                  onChange={handleChange('barangay')}
                  disabled={loading}
                  required
                />
              </div>
            </div>
          </div>

          {/* Farm Size */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-outline px-1">Farm Size (hectares) — optional</label>
            <div className="relative group">
              <input 
                className="w-full h-14 px-4 bg-surface-container-highest border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-on-background placeholder:text-outline transition-all" 
                placeholder="2.5" 
                type="number"
                step="0.1"
                min="0"
                value={form.farm_size}
                onChange={handleChange('farm_size')}
                disabled={loading}
              />
              <span className="absolute right-4 top-4 material-symbols-outlined text-outline group-focus-within:text-primary">grid_view</span>
            </div>
          </div>

          {/* CTA Button */}
          <div className="pt-4">
            <button 
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-gradient-to-br from-primary to-primary-container text-white font-headline text-lg font-bold rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Creating Account...
                </>
              ) : (
                <>
                  Create Account & Verify
                  <span className="material-symbols-outlined">arrow_forward</span>
                </>
              )}
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-outline-variant/10 text-center">
            <p className="text-on-surface font-semibold text-sm mb-4">
              Already have an account? <Link to="/login" className="text-secondary hover:underline decoration-2 underline-offset-4">Log in completely</Link>
            </p>
          </div>

          {/* Footer Links */}
          <div className="text-center pt-2">
            <p className="text-[11px] text-outline leading-relaxed opacity-70">
              By signing up you agree to our 
              <a href="#" className="text-primary font-medium hover:underline mx-1">Terms</a> 
              and 
              <a href="#" className="text-primary font-medium hover:underline mx-1">Privacy Policy</a>
            </p>
          </div>
        </form>

        {/* Decorative Organic Accent */}
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-tertiary to-secondary"></div>
      </main>

      {/* Floating Data Accents */}
      <div className="absolute bottom-10 left-10 hidden xl:block">
        <div className="bg-white/10 backdrop-blur-xl p-6 rounded-[2rem] shadow-2xl border border-white/10 max-w-xs text-white">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-10 w-10 bg-primary/20 rounded-full flex items-center justify-center text-primary-fixed">
              <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 1"}}>analytics</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-bold">Yield Projection</p>
              <p className="font-headline text-xl">+12.4% <span className="text-xs font-normal opacity-50">Increase</span></p>
            </div>
          </div>
          <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary-fixed w-[75%] shadow-[0_0_8px_rgba(120,252,156,0.3)]"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Registration;
