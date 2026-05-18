import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DiseaseDetection } from "@/types/database";
import { DISEASE_LABEL, SEVERITY_LABEL } from "@/types/domain";

// Fix Leaflet default icon paths (Vite + bundler)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function severityIcon(severity: "low" | "medium" | "high") {
  const color = SEVERITY_LABEL[severity].color;
  return L.divIcon({
    className: "rg-marker",
    html: `<div style="
      width:26px;height:26px;border-radius:50%;
      background:${color};
      border:3px solid white;
      box-shadow:0 4px 12px rgba(0,0,0,0.25);
    "></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

interface Props {
  center: [number, number];
  zoom?: number;
  detections?: DiseaseDetection[];
  onMapClick?: (lat: number, lng: number) => void;
  height?: string;
}

function ClickHandler({ onClick }: { onClick?: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!onClick) return;
    const h = (e: L.LeafletMouseEvent) => onClick(e.latlng.lat, e.latlng.lng);
    map.on("click", h);
    return () => {
      map.off("click", h);
    };
  }, [map, onClick]);
  return null;
}

export function LeafletMap({
  center,
  zoom = 14,
  detections = [],
  onMapClick,
  height = "500px",
}: Props) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height, width: "100%", borderRadius: "1rem" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onClick={onMapClick} />
      {detections.map((d) => (
        <Marker key={d.id} position={[d.lat, d.lng]} icon={severityIcon(d.severity)}>
          <Popup>
            <div className="font-display font-bold">{DISEASE_LABEL[d.disease].tl}</div>
            <div className="text-xs mt-1">
              Severity: <strong>{SEVERITY_LABEL[d.severity].tl}</strong>
            </div>
            {d.location_text && (
              <div className="text-xs text-stone-500 mt-1">{d.location_text}</div>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
