import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  GeoJSON,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { Expand, Layers, MapPin } from "lucide-react";
import type { LatLngBoundsExpression } from "leaflet";
import type { GeoJsonObject } from "geojson";
import "leaflet/dist/leaflet.css";
import type { Severity } from "./domain";
export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  severity: Severity;
  status?: string;
}
const colors: Record<Severity, string> = {
  low: "#648541",
  moderate: "#c88a27",
  high: "#b14d3e",
  not_calibrated: "#4d7280",
  unknown: "#73818b",
};
const severityLabels: Record<Severity, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  not_calibrated: "Not calibrated",
  unknown: "Unknown",
};
// Batanes is separated from the mainland by a large sea gap. Keep the useful
// mainland provinces in focus by default, with an explicit all-region view.
const MAINLAND_REGION_II: LatLngBoundsExpression = [
  [15.78, 120.8],
  [18.75, 122.65],
];
const ALL_REGION_II: LatLngBoundsExpression = [
  [15.78, 120.8],
  [21.18, 122.65],
];
const REGION_II_NAVIGATION: LatLngBoundsExpression = [
  [15.45, 120.45],
  [21.45, 122.95],
];
function MapActions({
  extent,
  onPick,
}: {
  extent: "mainland" | "all";
  onPick?: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    // A narrow, tall screen otherwise fits the mainland by width and exposes
    // much of Central Luzon below the region. Prioritize regional detail there.
    const compactPortrait = map.getSize().x < 500 && map.getSize().y > 500;
    if (extent === "mainland" && compactPortrait) {
      map.setView([17.3, 121.7], 8, { animate: false });
    } else {
      map.fitBounds(extent === "all" ? ALL_REGION_II : MAINLAND_REGION_II, {
        padding: [16, 16],
        maxZoom: 8,
        animate: false,
      });
    }
  }, [extent, map]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  useMapEvents({ click: (e) => onPick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}
export function FieldMap({
  points = [],
  onSelect,
  onPick,
  publicView = false,
  large = false,
}: {
  points?: MapPoint[];
  onSelect?: (id: string) => void;
  onPick?: (lat: number, lng: number) => void;
  publicView?: boolean;
  large?: boolean;
}) {
  const [layer, setLayer] = useState("standard");
  const [extent, setExtent] = useState<"mainland" | "all">("mainland");
  const [regionBoundary, setRegionBoundary] = useState<GeoJsonObject | null>(null);
  const mapKey = import.meta.env.VITE_MAPTILER_KEY;
  const visibleSeverities = [...new Set(points.map((point) => point.severity))];
  useEffect(() => {
    let active = true;
    fetch("/data/region-ii-boundary.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("Region boundary unavailable");
        return response.json() as Promise<GeoJsonObject>;
      })
      .then((boundary) => { if (active) setRegionBoundary(boundary); })
      .catch(() => { if (active) setRegionBoundary(null); });
    return () => { active = false; };
  }, []);
  return (
    <section
      className={`rg-map ${large ? "rg-map-large" : ""} ${points.length ? "" : "rg-map-no-points"}`}
      aria-label={
        publicView
          ? "Approved approximate advisory areas"
          : "Region II operations map"
      }
    >
      <div className="rg-map-tools">
        <div className="rg-segment" aria-label="Map background">
          <button
            className={layer === "standard" ? "selected" : ""}
            onClick={() => setLayer("standard")}
          >
            Standard
          </button>
          <button
            disabled={!mapKey}
            title={
              !mapKey
                ? "Configure a licensed MapTiler key to enable satellite imagery"
                : "Satellite reference imagery"
            }
            className={layer === "satellite" ? "selected" : ""}
            onClick={() => setLayer("satellite")}
          >
            <Layers size={14} /> Satellite
          </button>
        </div>
        <button
          className="rg-icon-button"
          aria-label={extent === "mainland" ? "Show all Region II including Batanes" : "Focus mainland Region II"}
          title={extent === "mainland" ? "Show Batanes and mainland Region II" : "Focus mainland Region II"}
          onClick={() => setExtent((current) => current === "mainland" ? "all" : "mainland")}
        >
          <Expand size={18} />
        </button>
      </div>
      <MapContainer
        center={[17.25, 121.7]}
        zoom={7}
        minZoom={6}
        maxZoom={20}
        maxBounds={REGION_II_NAVIGATION}
        maxBoundsViscosity={1}
        scrollWheelZoom={false}
        className="rg-leaflet"
      >
        <TileLayer
          key={layer}
          attribution={
            layer === "satellite"
              ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors'
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
          url={
            layer === "satellite"
              ? `https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${mapKey}`
              : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          }
        />
        <MapActions extent={extent} onPick={onPick} />
        {regionBoundary ? (
          <GeoJSON
            data={regionBoundary}
            interactive={false}
            style={{
              color: "#146b43",
              weight: 3,
              opacity: 0.9,
              fillColor: "#65a85c",
              fillOpacity: 0.08,
              dashArray: "8 6",
            }}
          />
        ) : null}
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={9}
            pathOptions={{
              fillColor: colors[p.severity],
              fillOpacity: 1,
              color: "white",
              weight: 3,
            }}
            eventHandlers={{ click: () => onSelect?.(p.id) }}
          >
            <Popup>
              <strong>{p.name}</strong>
              <br />
              {publicView ? "Approximate area" : p.status}
              <br />
              Reviewed assessment: {severityLabels[p.severity]}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="rg-map-caption">
        <MapPin size={14} />
        <span>
          {onPick
            ? "Tap the map to choose a survey pin. Location must be verified."
            : publicView
              ? points.length
                ? "Approximate areas only · not field boundaries"
                : "Region II view · no published map points yet"
              : extent === "all"
                ? "Region II · Batanes and mainland provinces"
                : "Mainland Region II · Batanes available in expanded view"}
        </span>
      </div>
      {visibleSeverities.length > 0 ? (
        <div className="rg-map-legend">
          {visibleSeverities.map((severity) => (
            <span key={severity}>
              <i style={{ background: colors[severity] }} />
              {severityLabels[severity]}
            </span>
          ))}
          <small>Reviewed assessment</small>
        </div>
      ) : null}
    </section>
  );
}
