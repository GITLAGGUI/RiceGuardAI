import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loginSendOtp, loginVerify, resendOtp } from '../services/api';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [step, setStep] = useState(1); // 1: Phone, 2: OTP
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef([]);
  const navigate = useNavigate();
  const { login, isAuthenticated, farmer } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && farmer) {
      // Navigate based on role
      if (farmer.role === 'admin') {
        navigate('/admin/overview', { replace: true });
      } else {
        navigate('/farmer/home', { replace: true });
      }
    }
  }, [isAuthenticated, farmer, navigate]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleSendOtp = async () => {
    if (!phone.trim()) {
      setError('Please enter your phone number.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await loginSendOtp(phone.trim());
      setFarmerName(data.farmer_name || '');
      setStep(2);
      setCountdown(60);
      // Focus first OTP input
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err.data?.message || 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

    // Auto-advance to next input
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits filled
    if (digit && index === 5 && newOtp.every(d => d !== '')) {
      handleVerify(newOtp);
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newOtp = pasted.split('');
      setOtp(newOtp);
      otpRefs.current[5]?.focus();
      handleVerify(newOtp);
    }
  };

  const handleVerify = async (otpArray = otp) => {
    const code = otpArray.join('');
    if (code.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await loginVerify(phone.trim(), code);
      // Update auth context with farmer data
      login(data.farmer);
      // Navigate based on role
      if (data.farmer.role === 'admin') {
        navigate('/admin/overview', { replace: true });
      } else {
        navigate('/farmer/home', { replace: true });
      }
    } catch (err) {
      setError(err.data?.message || 'Verification failed. Please try again.');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setLoading(true);
    setError('');

    try {
      await resendOtp(phone.trim());
      setCountdown(60);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } catch (err) {
      setError(err.data?.message || 'Failed to resend OTP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-body text-on-surface min-h-screen relative overflow-x-hidden flex items-center justify-center p-6 md:p-12">
      {/* Background Image Layer */}
      <div className="fixed inset-0 z-0">
        <img 
          className="w-full h-full object-cover grayscale-[20%] opacity-90" 
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuACngO4gt57alKUs-Bib_gfFItqoxtDPseUbvIYAMneX1nRl4K-GnpyOc1tBcFG9GSLerxWK_MvtAX-gtvKb6lda0OkSoI4cI9kq9hUtQlGZU62M8IoK6yYXizf391hr2tjh3RWVi6b-SjFAS2debAJ69a1pgRubGCHhP0oCcjYvHkKdahXf5cGS-nOowQpZTq51reHQ3oRdwOLjRPPcZ6DYLBKb3sUSB9HSaYn8Brvo9DFV4GG0ZgBc20KbP70pfhMC3uTLOPvQUU" 
          alt="Rice Paddy Background"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-on-background/40 to-transparent"></div>
      </div>

      {/* Main Content Container */}
      <main className="relative z-10 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {step === 1 ? (
          /* ──────── PHONE INPUT CARD ──────── */
          <div className="bg-surface/85 backdrop-blur-[24px] p-8 md:p-12 rounded-[2rem] shadow-2xl border border-white/20">
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-6 text-primary">
                <span className="material-symbols-outlined text-3xl">psychiatry</span>
                <span className="font-headline font-extrabold tracking-tighter text-2xl uppercase">RiceGuard AI</span>
              </div>
              <h1 className="font-headline text-4xl font-bold text-on-surface mb-2 tracking-tight">Welcome back, Farmer</h1>
              <p className="text-on-surface font-medium text-sm opacity-90">Enter your phone number to access your field data.</p>
            </div>
            
            {error && (
              <div className="mb-6 p-4 bg-error-container/20 border border-error/20 rounded-xl flex items-start gap-3">
                <span className="material-symbols-outlined text-error text-lg mt-0.5">error</span>
                <p className="text-sm text-error font-medium">{error}</p>
              </div>
            )}

            <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); handleSendOtp(); }}>
              <div>
                <label className="block text-xs font-bold text-on-surface/70 mb-3 tracking-wide uppercase">Phone Number</label>
                <div className="relative group flex items-center bg-surface-container-highest rounded-xl focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                  <div className="flex items-center pl-4 pr-3 text-on-surface/80 border-r border-outline-variant/30 select-none">
                    <span className="text-xl">🇵🇭</span>
                    <span className="ml-2 font-headline font-bold text-lg">+63</span>
                  </div>
                  <input 
                    className="flex-1 w-full pl-3 pr-4 py-4 bg-transparent border-none outline-none text-on-surface placeholder:text-outline/50 font-headline text-lg" 
                    placeholder="912 345 6789" 
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      let val = e.target.value.replace(/\D/g, '');
                      if (val.startsWith('0')) {
                        val = val.replace(/^0+/, '');
                      }
                      if (val.length > 0 && val[0] !== '9') {
                        val = '';
                      }
                      setPhone(val.slice(0, 10));
                    }}
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </div>
              <button 
                type="submit"
                disabled={loading}
                className="w-full py-5 bg-gradient-to-br from-primary to-primary-container text-white rounded-xl font-headline font-black text-lg tracking-tight hover:shadow-lg hover:shadow-primary/20 transition-all flex items-center justify-center gap-2 group shadow-xl border border-white/10 disabled:opacity-60 disabled:cursor-not-allowed" 
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span className="drop-shadow-md">Sending OTP...</span>
                  </>
                ) : (
                  <>
                    <span className="drop-shadow-md">Send OTP</span>
                    <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform drop-shadow-md">arrow_forward</span>
                  </>
                )}
              </button>
            </form>
            
            <div className="mt-8 pt-8 border-t border-outline-variant/10 text-center">
              <p className="text-on-surface font-semibold text-sm">
                New to the platform? <Link to="/register" className="text-secondary hover:underline decoration-2 underline-offset-4">Register your farm</Link>
              </p>
            </div>
          </div>
        ) : (
          /* ──────── OTP VERIFICATION CARD ──────── */
          <div className="bg-surface/85 backdrop-blur-[24px] p-8 md:p-12 rounded-[2rem] shadow-2xl border border-white/20">
            <div className="mb-10">
              <h2 className="font-headline text-4xl font-bold text-on-surface mb-2 tracking-tight">Verify your phone</h2>
              <p className="text-on-surface font-medium text-sm leading-relaxed opacity-90">
                We sent a 6-digit code to <span className="text-on-surface font-bold underline decoration-primary/30 decoration-2">+63 {phone.replace(/^0/, '').trim()}</span>
                {farmerName && <><br/>Welcome back, <span className="text-primary font-bold">{farmerName}</span>!</>}
              </p>
            </div>
            
            {error && (
              <div className="mb-6 p-4 bg-error-container/20 border border-error/20 rounded-xl flex items-start gap-3">
                <span className="material-symbols-outlined text-error text-lg mt-0.5">error</span>
                <p className="text-sm text-error font-medium">{error}</p>
              </div>
            )}

            <form className="space-y-10" onSubmit={(e) => { e.preventDefault(); handleVerify(); }}>
              <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input 
                    key={i}
                    ref={(el) => otpRefs.current[i] = el}
                    className="w-full h-16 text-center bg-surface-container-highest border-none rounded-xl focus:ring-2 focus:ring-primary/20 font-headline text-2xl font-bold text-primary shadow-sm" 
                    maxLength="1" 
                    type="text"
                    inputMode="numeric"
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    disabled={loading}
                  />
                ))}
              </div>
              
              <div className="text-center">
                <p className="text-on-surface font-bold text-xs mb-2 flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  {countdown > 0 ? (
                    <>Resend code in <span className="text-tertiary font-black font-headline tracking-widest bg-tertiary/10 px-2 py-0.5 rounded">{countdown}s</span></>
                  ) : (
                    <span className="text-on-surface-variant">Didn't receive the code?</span>
                  )}
                </p>
                <button 
                  onClick={handleResend}
                  className="text-secondary font-semibold text-sm hover:underline disabled:opacity-50" 
                  disabled={countdown > 0 || loading} 
                  type="button"
                >
                  Resend Code Now
                </button>
              </div>
              
              <button 
                type="submit"
                disabled={loading || otp.some(d => !d)}
                className="w-full py-5 bg-gradient-to-br from-primary to-primary-container text-white rounded-xl font-headline font-black text-lg tracking-tight hover:shadow-lg hover:shadow-primary/20 transition-all flex items-center justify-center gap-2 shadow-xl border border-white/10 disabled:opacity-60 disabled:cursor-not-allowed" 
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span className="drop-shadow-md">Verifying...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined drop-shadow-md">verified_user</span>
                    <span className="drop-shadow-md">Verify & Log In</span>
                  </>
                )}
              </button>
            </form>
            
            <div className="mt-8 pt-8 border-t border-outline-variant/10">
              <button 
                onClick={() => { setStep(1); setError(''); setOtp(['', '', '', '', '', '']); }}
                className="flex items-center gap-2 text-outline hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined">arrow_back</span>
                <span className="text-sm font-medium">Edit Phone Number</span>
              </button>
            </div>
          </div>
        )}
        
        {/* Desktop decorative stats */}
        <div className="hidden lg:flex flex-col justify-end h-full py-12 px-8 text-white">
            <div className="space-y-8">
                <div>
                   <span className="text-6xl font-bold font-headline tracking-tighter">98.4%</span>
                   <p className="text-[10px] uppercase tracking-[0.2em] opacity-70 font-bold mt-2">Detection Precision</p>
                </div>
                <div className="w-12 h-px bg-white/30"></div>
                <div>
                   <span className="text-6xl font-bold font-headline tracking-tighter">24/7</span>
                   <p className="text-[10px] uppercase tracking-[0.2em] opacity-70 font-bold mt-2">Autonomous Monitoring</p>
                </div>
            </div>
        </div>
      </main>

      {/* Help FAB */}
      <button className="fixed bottom-8 right-8 z-20 w-14 h-14 bg-surface-container-lowest text-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all">
        <span className="material-symbols-outlined">help_outline</span>
      </button>
    </div>
  );
};

export default Login;
