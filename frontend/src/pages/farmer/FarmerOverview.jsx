import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { divIcon } from 'leaflet';
import { useAuth } from '../../context/AuthContext';

const createCustomIcon = (color) => {
  return divIcon({
    className: 'custom-pin',
    html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50% 50% 50% 0; border: 2px solid white; transform: rotate(-45deg); box-shadow: 2px 2px 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 20],
    popupAnchor: [0, -20],
  });
};

const getSeverityColor = (severity) => {
  if (severity === 'High') return '#ef4444';
  if (severity === 'Medium') return '#eab308';
  return '#22c55e';
};

const API_BASE = 'http://localhost/RiceGuard/api';

const FarmerOverview = () => {
  const { farmer, token } = useAuth();
  const [stats, setStats] = useState(null);
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const firstName = farmer?.full_name?.split(' ')[0] || 'Farmer';
  const locationText = farmer?.barangay && farmer?.province
    ? `Brgy. ${farmer.barangay}, ${farmer.municipality || ''}, ${farmer.province}`.replace(', ,', ',')
    : 'your field';

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      try {
        // Fetch dashboard stats
        const statsRes = await fetch(`${API_BASE}/dashboard_stats.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const statsData = await statsRes.json();
        if (!statsData.error && active) setStats(statsData.data);

        // Fetch map detections
        const detectRes = await fetch(`${API_BASE}/get_detections.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const detectData = await detectRes.json();
        if (detectData.data && active) setDetections(detectData.data);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    const fetchWeather = async () => {
      try {
        setWeatherError('');
        const weatherRes = await fetch(`${API_BASE}/weather.php`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const weatherData = await weatherRes.json();

        if (!weatherRes.ok || weatherData.error) {
          throw new Error(weatherData.message || 'Hindi makuha ang weather data.');
        }

        if (active) {
          setWeather(weatherData.weather);
        }
      } catch (err) {
        console.error('Failed to fetch weather:', err);
        if (active) {
          setWeatherError(err.message || 'Hindi makuha ang weather data.');
        }
      } finally {
        if (active) {
          setWeatherLoading(false);
        }
      }
    };

    fetchData();
    fetchWeather();

    const weatherInterval = window.setInterval(fetchWeather, 300000);

    return () => {
      active = false;
      window.clearInterval(weatherInterval);
    };
  }, [token]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(clock);
  }, []);

  // Dynamic greeting
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Magandang Umaga' : hour < 17 ? 'Magandang Hapon' : 'Magandang Gabi';
  const farmSize = stats?.farm_size || farmer?.farm_size || '0';

  // Format last scan date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Wala pa';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fil-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days} araw na nakalipas`;
    if (hours > 0) return `${hours} oras na nakalipas`;
    return 'Kamakailan lang';
  };

  const formatClock = (dateValue) => {
    return dateValue.toLocaleString('fil-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getWeatherSourceLabel = (source) => {
    if (source === 'latest_detection') return 'Galing sa huling field coordinates';
    if (source === 'provided_coords') return 'Galing sa aktuwal na field coordinates';
    if (source === 'geocoded') return 'Tinantya mula sa rehistradong lokasyon';
    return 'Live weather feed';
  };

  const diseaseCount = stats?.diseases_found_count || 0;
  const diseaseNames = stats?.diseases_found_names?.join(' + ') || 'Wala';
  const advisoryCount = stats?.advisory_count || 0;
  const lastScanDate = stats?.last_scan_date;
  const mapCenter = detections.length > 0
    ? [parseFloat(detections[0].latitude), parseFloat(detections[0].longitude)]
    : [16.9242, 121.7584];
  const weatherCurrent = weather?.current;
  const weatherForecast = weather?.forecast;
  const weatherAgriculture = weather?.agriculture;
  const weatherLocation = weather?.location?.label || locationText;
  const weatherIcon = weatherCurrent?.icon
    ? `https://openweathermap.org/img/wn/${weatherCurrent.icon}@2x.png`
    : null;

  return (
    <div className="p-8 space-y-8 pb-32 max-w-7xl mx-auto">
      {/* HEADER & GREETING BANNER */}
      <section className="relative overflow-hidden rounded-xl bg-gradient-to-r from-[#296238] to-[#4c9a45] p-8 md:p-10 text-white shadow-sm flex flex-col justify-between min-h-[220px]">
        {/* Background wave pattern using CSS overlay if desired, kept simple flat here */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent opacity-50"></div>
        
        <div className="relative z-10 flex justify-between items-start w-full">
          <div className="flex gap-2 mb-4">
            <span className="bg-[#1e4829] text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
              SYSTEM LIVE
            </span>
            {diseaseCount > 0 ? (
              <span className="bg-error text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">
                MAY SAKIT NA NAKITA
              </span>
            ) : (
              <span className="bg-white/20 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border border-white/30">
                HEALTHY FIELD
              </span>
            )}
          </div>
          
          <div className="text-right">
            <p className="text-sm font-medium text-white/90">{formatClock(now)}</p>
          </div>
        </div>

        <div className="relative z-10 mt-auto flex flex-col md:flex-row md:justify-between md:items-end gap-6">
          <div className="space-y-1">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              {greeting}, {firstName}!
            </h2>
            <p className="text-white/90 text-sm md:text-base font-medium max-w-xl">
              Narito ang pinakahuling status ng iyong bukid sa {locationText}.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/30 shrink-0">
            <span className="material-symbols-outlined text-base">schedule</span>
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-sm">{formatDate(lastScanDate)}</span>
              <span className="text-[10px] uppercase text-white/70 font-semibold tracking-wider">Last Scan</span>
            </div>
          </div>
        </div>
      </section>

      {/* LIVE WEATHER */}
      <section className="grid grid-cols-1 gap-6">
        <div className="bg-[#5c7a8e] rounded-xl text-white shadow-sm p-6 md:p-8">
          <div className="flex justify-between items-start">
            <h3 className="text-xl font-bold">Kasalukuyang Panahon</h3>
            <p className="text-sm font-medium text-white/80">
              Updated {weather?.refreshed_at || 'Naglo-load...'}
            </p>
          </div>

          {weatherLoading ? (
            <div className="py-12 flex items-center gap-4">
              <div className="w-12 h-12 border-4 border-white/40 border-t-transparent rounded-full animate-spin"></div>
              <div>
                <p className="font-bold text-lg">Kinukuha ang live weather...</p>
              </div>
            </div>
          ) : weatherError ? (
            <div className="mt-8 rounded-xl bg-white/10 p-5 border border-white/20">
              <p className="font-bold text-lg">Hindi makuha ang weather data.</p>
              <p className="text-sm text-white/75 mt-1">{weatherError}</p>
            </div>
          ) : (
            <>
              <div className="mt-6 flex items-center gap-6">
                {weatherIcon ? (
                  <img src={weatherIcon} alt={weatherCurrent?.description || 'Weather'} className="w-28 h-28" />
                ) : (
                  <span className="material-symbols-outlined text-7xl text-yellow-300">light_mode</span>
                )}
                <div>
                  <p className="text-6xl md:text-7xl font-extrabold tracking-tighter">
                    {weatherCurrent?.temp_c ?? '--'}°C
                  </p>
                  <p className="text-xl font-semibold mt-1 capitalize">
                    {weatherCurrent?.description || 'Unknown weather'}
                  </p>
                  <p className="text-sm text-white/80">
                    Feels like {weatherCurrent?.feels_like_c ?? '--'}°C
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                <div className="bg-white rounded-lg p-4 text-gray-800 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-500 mb-2">
                    <span className="material-symbols-outlined text-sm">water_drop</span>
                    <p className="text-[10px] font-bold uppercase tracking-wider">Alinsangan</p>
                  </div>
                  <p className="text-2xl font-black">{weatherCurrent?.humidity_pct ?? '--'}%</p>
                </div>
                <div className="bg-white rounded-lg p-4 text-gray-800 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-500 mb-2">
                    <span className="material-symbols-outlined text-sm">air</span>
                    <p className="text-[10px] font-bold uppercase tracking-wider">Hangin</p>
                  </div>
                  <p className="text-2xl font-black">{weatherCurrent?.wind_kph ?? '--'} <span className="text-sm">kph</span></p>
                </div>
                <div className="bg-white rounded-lg p-4 text-gray-800 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-500 mb-2">
                    <span className="material-symbols-outlined text-sm">rainy</span>
                    <p className="text-[10px] font-bold uppercase tracking-wider">Posibilidad ng Ulan</p>
                  </div>
                  <p className="text-2xl font-black">{weatherForecast?.highest_pop_pct ?? '--'}%</p>
                </div>
                <div className="bg-white rounded-lg p-4 text-gray-800 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-500 mb-2">
                    <span className="material-symbols-outlined text-sm">wb_twilight</span>
                    <p className="text-[10px] font-bold uppercase tracking-wider">Paglubug ng Araw</p>
                  </div>
                  <p className="text-2xl font-black">{weatherCurrent?.sunset_at || '--'}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-xl font-bold text-gray-900">Field Conditions</h3>
                <span className="bg-yellow-100 text-yellow-800 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full tracking-wider">
                  WEATHER-AWARE FARM ACTION
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`text-[11px] font-bold px-3 py-1 rounded-full text-white ${
                  weatherAgriculture?.disease_pressure === 'High' ? 'bg-red-500' : weatherAgriculture?.disease_pressure === 'Moderate' ? 'bg-orange-500' : 'bg-green-500'
                }`}>
                  Disease Risk: {weatherAgriculture?.disease_pressure === 'High' ? 'Mataas' : weatherAgriculture?.disease_pressure === 'Moderate' ? 'Katamtaman' : 'Mababa'}
                </span>
                <span className={`text-[11px] font-bold px-3 py-1 rounded-full text-white ${
                  weatherAgriculture?.spray_window === 'Poor' ? 'bg-orange-500' : weatherAgriculture?.spray_window === 'Caution' ? 'bg-yellow-500' : 'bg-green-500'
                }`}>
                  Spray Window: {weatherAgriculture?.spray_window === 'Poor' ? 'Iwasan' : weatherAgriculture?.spray_window === 'Caution' ? 'Mag-ingat' : 'Maganda'}
                </span>
              </div>
            </div>
            <button className="bg-white border border-gray-300 text-gray-700 text-sm font-bold px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors shrink-0">
              Tingnan a ng Buo
            </button>
          </div>

          {weatherLoading ? (
            <div className="py-10 flex items-center gap-3">
              <div className="w-8 h-8 border-4 border-emerald-500/40 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm text-gray-600">Inaayos ang weather-driven field hints...</p>
            </div>
          ) : weatherError ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
              <p className="font-bold text-gray-800">Walang live weather insights sa ngayon.</p>
              <p className="text-sm text-gray-500 mt-1">Susubukan ulit ito sa susunod na auto-refresh cycle.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="font-bold text-gray-900 mb-1">Field Note</p>
                <p className="text-gray-700 text-sm leading-relaxed">
                  {weatherAgriculture?.field_note || 'Mag-monitor ng panahon bago magsagawa ng field action.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(weatherAgriculture?.factors || []).map((factor) => (
                    <span key={factor} className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                      {factor}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100">
                <div className="flex items-center gap-4 overflow-x-auto pb-4 custom-scrollbar">
                  {(weatherForecast?.entries || []).slice(0, 4).map((entry) => (
                    <div key={`${entry.time}-${entry.condition}`} className="min-w-[140px] rounded-xl border border-gray-200 bg-white p-4 shrink-0 shadow-sm relative group cursor-pointer hover:border-emerald-500 transition-colors">
                      <p className="text-[11px] font-bold text-gray-900 mb-2">{entry.time}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="material-symbols-outlined text-yellow-500">
                           {entry.condition?.toLowerCase().includes('cloud') ? 'cloud' : 'wb_sunny'}
                        </span>
                        <p className="text-xl font-black text-gray-900">{entry.temp_c}°C</p>
                      </div>
                      <p className="text-[10px] font-semibold text-gray-600 truncate">{entry.description || entry.condition}</p>
                      <p className="text-[10px] font-bold text-blue-600 mt-1">{entry.pop_pct}% ulan</p>
                    </div>
                  ))}
                  
                  <button className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center shrink-0 hover:bg-gray-50 transition-colors ml-2 shadow-sm text-gray-500 hover:text-gray-900">
                    <span className="material-symbols-outlined text-xl">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* KPI ROW */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:border-gray-300 transition-colors">
          <p className="text-gray-500 text-[11px] font-bold uppercase tracking-wider mb-2">Sukat ng Bukid</p>
          <p className="text-3xl font-black text-gray-900 leading-tight">{farmSize} <span className="text-base font-bold">ektarya</span></p>
          <p className="text-xs text-gray-500 font-semibold mt-1">(Aktibo)</p>
        </div>

        <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:border-gray-300 transition-colors">
          <p className="text-gray-500 text-[11px] font-bold uppercase tracking-wider mb-2">Huling Scan</p>
          <p className="text-3xl font-black text-gray-900 leading-tight">{formatDate(lastScanDate)}</p>
          <p className="text-xs text-transparent select-none mt-1">_</p>
        </div>

        <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:border-gray-300 transition-colors">
          <p className="text-gray-500 text-[11px] font-bold uppercase tracking-wider mb-2">Sakit na Nakita</p>
          <p className="text-3xl font-black text-gray-900 leading-tight">{diseaseCount}</p>
          <p className="text-xs text-gray-500 font-semibold mt-1">{diseaseNames}</p>
        </div>

        <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:border-gray-300 transition-colors">
          <p className="text-gray-500 text-[11px] font-bold uppercase tracking-wider mb-2">Mga Payo</p>
          <p className="text-3xl font-black text-gray-900 leading-tight">{advisoryCount}</p>
          <p className="text-xs text-gray-500 font-semibold mt-1">{advisoryCount > 0 ? 'Nakabinbin' : 'Wala'}</p>
        </div>
      </section>

      {/* MAIN LAYOUT: FIELD MAP & ALERTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 md:p-6 flex justify-between items-center border-b border-gray-100">
            <h3 className="text-xl font-black text-gray-900">Resulta ng Huling Scan</h3>
            <a href="/farmer/map" className="bg-white border border-gray-300 text-gray-700 text-sm font-bold px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors shrink-0">
              Tingnan ng Buo
            </a>
          </div>

          <div className="relative z-0 flex-grow h-[400px] lg:h-[500px]">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-[500]">
                <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : (
              <MapContainer center={mapCenter} zoom={17} style={{ height: '100%', width: '100%' }} zoomControl={false} scrollWheelZoom={false}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
                {detections.map(point => (
                  <Marker
                    key={point.id}
                    position={[parseFloat(point.latitude), parseFloat(point.longitude)]}
                    icon={createCustomIcon(getSeverityColor(point.severity))}
                  >
                    <Popup>
                      <span className="font-bold">{point.disease}</span>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            )}

            {detections.length === 0 && !loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-transparent pointer-events-none z-[500]">
                <div className="bg-white px-8 py-6 rounded-2xl shadow-lg text-center max-w-[280px] pointer-events-auto border border-gray-200">
                  <span className="material-symbols-outlined text-4xl text-gray-400 mb-3 block">drone</span>
                  <p className="font-bold text-gray-900 leading-snug">Wala pang naso-scan.</p>
                  <p className="text-sm text-gray-600 leading-snug mt-1">Maghintay ng drone scan mula sa admin.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT: ACTIVE ALERTS */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col min-h-[400px]">
          <h3 className="text-xl font-black text-gray-900 mb-6">Mga Aktibong Alerto</h3>
          
          <div className="space-y-4 flex-grow flex flex-col">
            {loading ? (
              <div className="flex-grow flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : detections.length === 0 ? (
              <div className="flex-grow flex flex-col items-center justify-center text-center px-4">
                <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-sm">
                  <span className="material-symbols-outlined text-white text-5xl">check</span>
                </div>
                <p className="font-bold text-gray-900 text-lg mb-1">Walang aktibong alerto.</p>
                <p className="text-sm text-gray-600">Malusog ang iyong bukid base sa huling scan.</p>
              </div>
            ) : (
              detections.slice(0, 3).map((det, idx) => {
                const isHigh = det.severity === 'High';
                const borderColor = isHigh ? 'border-l-red-500' : 'border-l-yellow-500';
                const iconBg = isHigh ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700';
                const badgeBg = isHigh ? 'bg-red-600' : 'bg-yellow-500';

                return (
                  <div key={det.id || idx} className={`bg-gray-50 p-4 rounded-xl border border-gray-200 ${borderColor} border-l-4 shadow-sm space-y-3`}>
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 ${iconBg} rounded-lg`}>
                          <span className="material-symbols-outlined">{isHigh ? 'dangerous' : 'priority_high'}</span>
                        </div>
                        <div>
                          <span className={`${badgeBg} text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter`}>{det.disease}</span>
                          <h4 className="text-sm font-bold text-gray-900 mt-1">{det.severity} na Panganib</h4>
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Natagpuan: {new Date(det.created_at).toLocaleString('fil-PH')}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default FarmerOverview;
