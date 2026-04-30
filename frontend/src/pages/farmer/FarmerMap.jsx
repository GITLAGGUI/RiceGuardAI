import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { divIcon } from 'leaflet';

// Center fallback
const FIELD_CENTER = [17.6, 121.75]; 

const getSeverityColor = (severity) => {
  if (severity === 'High') return '#ef4444'; // error
  if (severity === 'Medium') return '#eab308'; // warning
  return '#22c55e'; // healthy/low
};

const getAdvice = (disease) => {
  if (disease === 'Rice Blast') return 'Mag-spray agad ng fungicide';
  if (disease === 'Tungro') return 'Bunutin ang may sakit na palay at mag-apply ng insect control';
  if (disease === 'Bacterial Leaf Blight') return 'Mag-apply ng copper-based bactericide';
  return 'Ipagpatuloy ang tamang pag-aalaga';
};

const createCustomIcon = (color) => {
  return divIcon({
    className: 'custom-pin',
    html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50% 50% 50% 0; border: 3px solid white; transform: rotate(-45deg); box-shadow: 2px 2px 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
};

const createUserLocationIcon = () => {
  return divIcon({
    className: 'user-pin',
    html: `<div style="background-color: #3b82f6; width: 18px; height: 18px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(59, 130, 246, 0.8);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });
};

const FarmerMap = () => {
  const [detectedDiseases, setDetectedDiseases] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    // Fetch live detections from backend
    const fetchDetections = async () => {
      try {
        const res = await fetch('http://localhost/RiceGuard/api/get_detections.php', {
          headers: {
            'Authorization': 'Bearer ' + localStorage.getItem('rg_token')
          }
        });
        const json = await res.json();
        if (!json.error && json.data) {
          setDetectedDiseases(json.data);
        }
      } catch (err) {
        console.error('Failed to fetch detections:', err);
      }
    };
    fetchDetections();
  }, []);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert("Hindi suportado ng iyong browser ang Geolocation.");
      return;
    }
    
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const newLoc = [latitude, longitude];
        setUserLocation(newLoc);
        setIsLocating(false);
        // Automatically fly to user location if map is ready
        if (mapRef.current) {
           mapRef.current.flyTo(newLoc, 17, { animate: true });
        }
      },
      (error) => {
        setIsLocating(false);
        alert("Hindi makuha ang iyong lokasyon. Pakisuri kung naka-on ang GPS / Location settings mo.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface-container-lowest">
      <header className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-6 relative z-10 px-8 pt-8">
        <div>
          <h1 className="text-3xl font-extrabold text-on-surface tracking-tight mb-2">Mapa ng Aking Bukid</h1>
          <p className="text-lg text-on-surface-variant font-medium">Tingnan ang eksaktong lokasyon ng sakit ng palay gamit ang Drone GPS.</p>
        </div>
      </header>

      <div className="relative bg-surface rounded-xl overflow-hidden shadow-2xl border border-outline-variant/20 flex-1 mx-8 mb-8 flex flex-col md:flex-row min-h-[600px]">
        
        {/* Sidebar Summary */}
        <aside className="w-full md:w-96 bg-white border-r border-outline-variant/10 flex flex-col z-20 relative h-full">
          <div className="p-6 border-b border-outline-variant/10 bg-green-50">
            <h2 className="text-lg font-bold text-green-900 uppercase tracking-widest flex items-center gap-2">
              <span className="material-symbols-outlined text-[24px]">radar</span>
              Resulta ng Drone Scan
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {detectedDiseases.length === 0 ? (
                <p className="text-sm text-gray-600 mb-2 font-medium">Walang natagpuang sakit sa iyong bukid sa huling scan.</p>
            ) : (
                <p className="text-sm text-gray-600 mb-2 font-medium">May natagpuang sakit sa mga sumusunod na lokasyon:</p>
            )}
            
            {detectedDiseases.map(point => (
              <div key={point.id} className="p-4 rounded-xl border border-gray-100 shadow-sm flex items-start gap-3 bg-white hover:bg-gray-50 transition-colors">
                <div className="mt-1">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: getSeverityColor(point.severity) }}></div>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{point.disease}</h3>
                  <p className="text-sm font-semibold text-gray-500 mb-2">Severity: <span style={{color: getSeverityColor(point.severity)}}>{point.severity}</span></p>
                  <div className="bg-gray-100 p-2 rounded text-sm text-gray-700 font-medium">
                    <span className="material-symbols-outlined text-[16px] align-middle mr-1">lightbulb</span>
                    {getAdvice(point.disease)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 border-t border-outline-variant/10 bg-white">
             <button 
                onClick={handleLocateMe}
                disabled={isLocating}
                className="w-full bg-[#2563eb] text-white py-3 rounded-xl text-md font-bold flex items-center justify-center gap-2 hover:bg-[#1d4ed8] transition-colors shadow-md disabled:opacity-70"
             >
               <span className="material-symbols-outlined">{isLocating ? 'hourglass_empty' : 'my_location'}</span>
               {isLocating ? 'Hinahanap...' : 'Nasaan Ako Ngayon?'}
             </button>
             <p className="text-xs text-center mt-3 text-gray-500 font-medium">Patuloy na sinusubaybayan ng admin ang iyong bukid gamit ang drones.</p>
          </div>
        </aside>

        {/* Map Area */}
        <div className="flex-1 relative bg-[#e5e5e5] overflow-hidden z-10 h-full">
          <MapContainer 
            center={FIELD_CENTER} 
            zoom={17} 
            style={{ height: '100%', width: '100%' }} 
            zoomControl={true} 
            scrollWheelZoom={true}
            ref={mapRef}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />

            {/* Render Pin Markers based on Drone Scan Data */}
            {detectedDiseases.map(point => (
              <Marker 
                key={point.id} 
                position={[point.latitude, point.longitude]} 
                icon={createCustomIcon(getSeverityColor(point.severity))}
              >
                <Popup className="custom-popup">
                  <div className="p-2 min-w-[150px]">
                    <h3 className="font-bold text-lg" style={{ color: getSeverityColor(point.severity) }}>{point.disease}</h3>
                    <p className="text-sm font-bold text-gray-600 mb-2">Severity: {point.severity}</p>
                    <p className="text-sm bg-gray-100 p-2 rounded">{getAdvice(point.disease)}</p>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* User Current Location Marker */}
            {userLocation && (
              <Marker position={userLocation} icon={createUserLocationIcon()}>
                <Popup className="custom-popup">
                  <div className="p-2 text-center">
                    <h3 className="font-bold text-[#2563eb] text-sm">Aking Lokasyon</h3>
                    <p className="text-xs text-gray-600">Dito ka kasalukuyang nakatayo.</p>
                  </div>
                </Popup>
              </Marker>
            )}
            
          </MapContainer>

          {/* Floating Map Legend (Keys) */}
          <div className="absolute bottom-6 right-6 z-[400] bg-white/95 backdrop-blur-md p-5 rounded-2xl shadow-2xl border border-gray-200 min-w-[200px]">
             <h4 className="text-sm font-extrabold text-gray-800 uppercase tracking-widest mb-4 flex items-center gap-2">
               <span className="material-symbols-outlined text-lg text-gray-500">key</span>
               Map Legend (Keys)
             </h4>
             <div className="space-y-3">
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-full bg-[#ef4444] border-2 border-white shadow-md"></div>
                 <span className="text-sm font-bold text-gray-700">Rice Blast (Kritikal)</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-full bg-[#f97316] border-2 border-white shadow-md"></div>
                 <span className="text-sm font-bold text-gray-700">Tungro (Mataas)</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-full bg-[#eab308] border-2 border-white shadow-md"></div>
                 <span className="text-sm font-bold text-gray-700">Bacterial Leaf Blight</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-5 h-5 rounded-full bg-[#22c55e] border-2 border-white shadow-md"></div>
                 <span className="text-sm font-bold text-gray-700">Healthy (Walang Sakit)</span>
               </div>
               <div className="flex items-center gap-3 pt-2 border-t border-gray-100 mt-2">
                 <div className="w-4 h-4 rounded-full bg-[#3b82f6] border-2 border-white shadow-md"></div>
                 <span className="text-sm font-bold text-[#3b82f6]">Aking Lokasyon</span>
               </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FarmerMap;

