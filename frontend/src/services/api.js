/**
 * RiceGuard AI - Centralized API Service
 * 
 * All backend calls go through this module.
 * Token is auto-attached from localStorage.
 */

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/**
 * Core fetch wrapper with auth header injection
 */
async function request(endpoint, options = {}) {
  const token = localStorage.getItem('rg_token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json();

  // If 401, clear stale token
  if (res.status === 401 && token) {
    localStorage.removeItem('rg_token');
    localStorage.removeItem('rg_farmer');
  }

  if (!res.ok) {
    const error = new Error(data.message || 'Request failed');
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

// ============================================
// AUTH ENDPOINTS
// ============================================

/**
 * Send OTP to phone for login
 * @param {string} phone - e.g. "+639171234567"
 */
export async function loginSendOtp(phone) {
  return request('/auth.php?action=login', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

/**
 * Verify OTP and get session token
 * @param {string} phone
 * @param {string} code - 6-digit OTP
 */
export async function loginVerify(phone, code) {
  const data = await request('/auth.php?action=verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
  });

  // Store token and farmer data on success
  if (data.token) {
    localStorage.setItem('rg_token', data.token);
    localStorage.setItem('rg_farmer', JSON.stringify(data.farmer));
  }

  return data;
}

/**
 * Register a new farmer account
 */
export async function registerFarmer({ full_name, phone, province, municipality, barangay, farm_size }) {
  return request('/auth.php?action=register', {
    method: 'POST',
    body: JSON.stringify({ full_name, phone, province, municipality, barangay, farm_size }),
  });
}

/**
 * Check if current token is valid
 */
export async function checkAuth() {
  return request('/auth.php?action=check');
}

/**
 * Resend OTP to a phone number
 */
export async function resendOtp(phone) {
  return request('/auth.php?action=resend', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}

/**
 * Logout - invalidate token on server
 */
export async function logout() {
  try {
    await request('/auth.php?action=logout', { method: 'POST' });
  } catch (e) {
    // Ignore errors — we clear local state regardless
  }
  localStorage.removeItem('rg_token');
  localStorage.removeItem('rg_farmer');
}

// ============================================
// FARMER ENDPOINTS
// ============================================

/**
 * Get farmer dashboard data (profile + stats + recent alerts)
 */
export async function getFarmerDashboard() {
  return request('/farmer.php?action=dashboard');
}

/**
 * Get farmer's alert history
 */
export async function getFarmerAlerts() {
  return request('/farmer.php?action=alerts');
}

/**
 * Get farmer's profile
 */
export async function getFarmerProfile() {
  return request('/farmer.php?action=profile');
}

/**
 * Update farmer's profile
 */
export async function updateFarmerProfile(data) {
  return request('/farmer.php?action=update_profile', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Get notification preferences
 */
export async function getPreferences() {
  return request('/farmer.php?action=preferences');
}

/**
 * Update notification preferences
 */
export async function updatePreferences(prefs) {
  return request('/farmer.php?action=preferences', {
    method: 'POST',
    body: JSON.stringify(prefs),
  });
}
