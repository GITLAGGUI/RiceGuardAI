import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
});

const FIELD_CENTER = [17.6, 121.75]; // Centered around Isabela/Cagayan

const getSeverityColor = (severity) => {
  if (severity === 'High') return 'text-error';
  if (severity === 'Medium') return 'text-tertiary';
  return 'text-primary';
};

const AdminMap = () => {
  const [detections, setDetections] = useState([]);

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
          setDetections(json.data);
        }
      } catch (err) {
        console.error('Failed to fetch detections:', err);
      }
    };
    fetchDetections();
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-surface-container-lowest overflow-hidden rounded-xl shadow-ambient mb-8 border border-outline-variant/20">
      <header className="flex flex-col md:flex-row md:items-center justify-between p-6 border-b border-outline-variant/10 bg-surface z-10">
        <div>
          <h1 className="text-xl font-bold text-on-surface tracking-tight">Global Disease Map</h1>
          <p className="text-sm text-on-surface-variant">Real-time geographical tracking of disease spread across all registered farms.</p>
        </div>
        <div className="flex items-center gap-2 bg-surface-container-high p-1 rounded-lg mt-4 md:mt-0">
          <button className="px-4 py-2 rounded-md bg-surface text-on-surface text-xs font-bold shadow-sm border border-outline-variant/10">All Regions</button>
          <button className="px-4 py-2 rounded-md text-on-surface-variant text-xs font-semibold hover:bg-surface-container-highest transition-colors">Critical Only</button>
        </div>
      </header>

      <div className="flex-1 relative flex flex-col md:flex-row">
        {/* Sidebar within Map */}
        <aside className="w-full md:w-80 bg-surface-container-lowest border-r border-outline-variant/10 flex flex-col z-20 relative h-full">
          <div className="p-4 border-b border-outline-variant/10">
            <h2 className="text-sm font-bold text-on-surface uppercase tracking-widest flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">travel_explore</span>
              Farm Overview
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {detections.length === 0 ? (
               <p className="text-sm text-on-surface-variant p-4 text-center">No disease detections found. Run a scan to see data.</p>
            ) : (
               detections.map((det) => (
                 <div key={det.id} className={`p-4 rounded-xl ghost-border border-l-4 transition-colors ${
                    det.severity === 'High' ? 'border-error bg-error/5 hover:bg-error/10' :
                    det.severity === 'Medium' ? 'border-tertiary bg-tertiary/5 hover:bg-tertiary/10' :
                    'border-primary bg-primary/5 hover:bg-primary/10'
                 }`}>
                   <div className="flex justify-between items-start mb-2">
                     <h3 className="font-bold text-on-surface text-sm">{det.disease}</h3>
                     <span className={`text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        det.severity === 'High' ? 'bg-error' :
                        det.severity === 'Medium' ? 'bg-tertiary' : 'bg-primary'
                     }`}>
                       {det.severity}
                     </span>
                   </div>
                   <p className="text-xs text-on-surface-variant">Farmer ID: {det.farmer_id || 'Unknown'}</p>
                   <p className="text-xs text-on-surface-variant mt-1">Date: {new Date(det.created_at).toLocaleString()}</p>
                 </div>
               ))
            )}
          </div>
        </aside>

        {/* Map Area */}
        <div className="flex-1 relative bg-[#2A3620] overflow-hidden z-10 h-full">
          <MapContainer center={FIELD_CENTER} zoom={12} style={{ height: '100%', width: '100%' }} zoomControl={true} scrollWheelZoom={true}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />

            {/* Dynamic Markers from DB */}
            {detections.map(det => (
               <Marker key={det.id} position={[det.latitude, det.longitude]}>
                 <Popup>
                   <div className="p-2 space-y-1">
                     <h3 className={`font-bold ${getSeverityColor(det.severity)}`}>{det.disease}</h3>
                     <p className="text-xs font-bold uppercase">Severity: {det.severity}</p>
                     <p className="text-[10px] text-on-surface-variant">Lat: {det.latitude}</p>
                     <p className="text-[10px] text-on-surface-variant">Lon: {det.longitude}</p>
                     <p className="text-xs text-on-surface-variant mt-2">Recommended Action:<br/>
                        {det.disease === 'Rice Blast' ? 'Apply targeted fungicide' : 
                         det.disease === 'Tungro' ? 'Apply insect vector control' : 'Apply copper-based bactericide'}
                     </p>
                   </div>
                 </Popup>
               </Marker>
            ))}
          </MapContainer>

          <div className="absolute bottom-4 right-4 z-[400] bg-surface/90 backdrop-blur-md p-4 rounded-xl shadow-lg border border-outline-variant/20 w-48">
             <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-3">Map Legend</h4>
             <div className="space-y-2">
               <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-primary/40 border border-primary"></div><span className="text-xs font-medium text-on-surface">Healthy</span></div>
               <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-tertiary/40 border border-tertiary"></div><span className="text-xs font-medium text-on-surface">Warning</span></div>
               <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-error/40 border border-error border-dashed"></div><span className="text-xs font-medium text-error">Critical</span></div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminMap;
