import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  GeoJSON,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { Expand, Layers, MapPin, LocateFixed } from "lucide-react";
import { groupMapPoints } from "./mapPoints";
import { divIcon } from "leaflet";
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
  location?: string;
  image?: string;
  diseases?: string[];
  href?: string;
}

function MapPointMarker({
  point,
  neighbors = [point],
  publicView,
  onSelect,
  focused = false,
}: {
  point: MapPoint;
  neighbors?: MapPoint[];
  publicView: boolean;
  onSelect?: (id: string) => void;
  focused?: boolean;
}) {
  const reviewedWithoutCalibration = point.status === "Reviewed" && ["not_calibrated", "unknown"].includes(point.severity);
  const markerColor = reviewedWithoutCalibration ? "#73818b" : colors[point.severity];
  const markerLabel = reviewedWithoutCalibration ? "Approved · field severity not assessed" : severityLabels[point.severity];
  const icon = useMemo(() => divIcon({
    className: "rg-field-pin",
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42" aria-hidden="true"><path d="M15 40C12 35 2 25 2 15a13 13 0 1 1 26 0c0 10-10 20-13 25Z" fill="${markerColor}" stroke="white" stroke-width="2.5"/><circle cx="15" cy="15" r="4.5" fill="white"/></svg>`,
    iconSize: [30, 42], iconAnchor: [15, 40], popupAnchor: [0, -36], tooltipAnchor: [16, -27],
  }), [markerColor]);
  return (
    <Marker
      position={[point.lat, point.lng]}
      icon={icon}
      zIndexOffset={focused ? 1000 : 0}
      title={point.name}
      alt={`Survey pin: ${point.name}`}
      eventHandlers={{
        click: () => {
          onSelect?.(point.id);
        },
      }}
    >
      <Tooltip>{point.name}{neighbors.length>1 ? ` · ${neighbors.length} posts share this location` : ""}</Tooltip>
      <Popup minWidth={230} maxWidth={310} autoPanPadding={[28, 28]}>
        {neighbors.length>1 ? <div className="rg-map-shared"><strong>{neighbors.length} posts at the same location</strong><p>Each post keeps its own pin. Shared coordinates overlap; choose the post below. Locations are not moved to separate them.</p><ul>{neighbors.map(item=><li key={item.id}>{item.href?<a href={item.href}>{item.name}</a>:<button type="button" onClick={()=>onSelect?.(item.id)}>{item.name}</button>}<small>{item.location || item.status} · {severityLabels[item.severity]}</small></li>)}</ul></div> :
        <article className="rg-map-popup-card">
          {point.image ? <img src={point.image} alt={`Approved field preview for ${point.name}`} /> : null}
          <div>
            <strong>{point.name}</strong>
            <span>{point.location || (publicView ? "Approved approximate survey area" : point.status)}</span>
            <dl>
              <dt>Coordinates</dt>
              <dd>{point.lat.toFixed(publicView ? 2 : 6)}, {point.lng.toFixed(publicView ? 2 : 6)} ({publicView ? "approximate" : "survey reference"})</dd>
              <dt>Detected</dt>
              <dd>{point.diseases?.length ? point.diseases.join(" and ") : "Reviewed target finding"}</dd>
              <dt>Severity</dt>
              <dd><i style={{ background: markerColor }} />{markerLabel}</dd>
            </dl>
            {point.href ? <a href={point.href}>Open full field bulletin</a> : null}
          </div>
        </article>}
      </Popup>
    </Marker>
  );
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
  high: "Severe",
  not_calibrated: "Severity not assessed",
  unknown: "Severity not assessed",
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
function MapMarkers({points,focusId,publicView,onSelect}:{points:MapPoint[];focusId?:string;publicView:boolean;onSelect?:(id:string)=>void}) {
 const groups=groupMapPoints(points);
 // Render every record at its saved position. Do not cluster nearby places or
 // move exact/shared coordinates merely to make markers look distinct.
 return <>{groups.flatMap(g=>[...g.points].sort((a,b)=>Number(a.id===focusId)-Number(b.id===focusId)).map(point=><MapPointMarker key={point.id} point={point} neighbors={g.points} publicView={publicView} focused={point.id===focusId} onSelect={onSelect}/>) )}</>;
}
function MapActions({
  extent,
  resetKey,
  onPick,
}: {
  extent: "mainland" | "all";
  resetKey: number;
  onPick?: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize({pan:false});
    // Keep the operational mainland view closer by default. Compact preview
    // cards stay one level wider so the regional context is still legible.
    if (extent === "mainland") {
      const detailZoom = map.getSize().y < 320 ? 7 : 8;
      map.setView([17.4, 121.72], detailZoom, { animate: false });
    } else {
      map.fitBounds(extent === "all" ? ALL_REGION_II : MAINLAND_REGION_II, {
        padding: [16, 16],
        maxZoom: 8,
        animate: false,
      });
    }
  }, [extent, map, resetKey]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({pan:false}));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  useMapEvents({ click: (e) => onPick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}
function FocusReviewPoint({point}:{point?:MapPoint}) {
  const map=useMap();
  const id=point?.id,lat=point?.lat,lng=point?.lng;
  useEffect(()=>{if(id && lat!=null && lng!=null)map.setView([lat,lng],13,{animate:false});},[map,id,lat,lng]);
  return null;
}
export function FieldMap({
  points = [],
  onSelect,
  onPick,
  publicView = false,
  large = false,
  focusId,
}: {
  points?: MapPoint[];
  onSelect?: (id: string) => void;
  onPick?: (lat: number, lng: number) => void;
  publicView?: boolean;
  large?: boolean;
  focusId?: string;
}) {
  const [layer, setLayer] = useState("standard");
  const [extent, setExtent] = useState<"mainland" | "all">("mainland");
  const [resetKey,setResetKey]=useState(0);
  const [regionBoundary, setRegionBoundary] = useState<GeoJsonObject | null>(null);
  const visibleSeverities = [...new Set(points.map((point) => point.severity))];
  const hasReviewedUncalibrated = points.some((point) => point.status === "Reviewed" && ["not_calibrated", "unknown"].includes(point.severity));
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
      data-lenis-prevent-wheel
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
            title="Satellite reference imagery"
            className={layer === "satellite" ? "selected" : ""}
            onClick={() => setLayer("satellite")}
          >
            <Layers size={14} /> Satellite
          </button>
        </div>
        <div className="rg-map-view-actions"><button type="button" className="rg-icon-button" aria-label="Reset map to Region II" title="Reset map to Region II" onClick={()=>{setExtent("mainland");setResetKey(k=>k+1);}}><LocateFixed size={18}/></button><button
          className="rg-icon-button"
          aria-label={extent === "mainland" ? "Show all Region II including Batanes" : "Focus mainland Region II"}
          title={extent === "mainland" ? "Show Batanes and mainland Region II" : "Focus mainland Region II"}
          onClick={() => setExtent((current) => current === "mainland" ? "all" : "mainland")}
        >
          <Expand size={18} />
        </button></div>
      </div>
      <MapContainer
        center={[17.25, 121.7]}
        zoom={7}
        minZoom={3}
        maxZoom={21}
        scrollWheelZoom
        className="rg-leaflet"
      >
        <TileLayer
          key={layer}
          maxNativeZoom={19}
          maxZoom={21}
          attribution={
            layer === "satellite"
              ? 'Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
          url={
            layer === "satellite"
              ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          }
        />
        <MapActions extent={extent} resetKey={resetKey} onPick={onPick} />
        <FocusReviewPoint point={points.find(point=>point.id===focusId)} />
        {regionBoundary ? (
          <GeoJSON
            key={`boundary-${layer}`}
            data={regionBoundary}
            interactive={false}
            style={{
              // White reads on dark satellite imagery; green on the light street map.
              color: layer === "satellite" ? "#ffffff" : "#146b43",
              weight: 2.5,
              opacity: layer === "satellite" ? 0.95 : 0.88,
              fillColor: layer === "satellite" ? "#ffffff" : "#65a85c",
              fillOpacity: layer === "satellite" ? 0.04 : 0.06,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        ) : null}
        <MapMarkers points={points} focusId={focusId} publicView={publicView} onSelect={onSelect}/>
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
          {hasReviewedUncalibrated ? <span><i style={{ background: "#73818b" }} />Approved · severity not assessed</span> : null}
          {visibleSeverities.map((severity) => (
            hasReviewedUncalibrated && ["not_calibrated", "unknown"].includes(severity) ? null :
            <span key={severity}>
              <i style={{ background: colors[severity] }} />
              {severityLabels[severity]}
            </span>
          ))}
          <small>Reviewed damage grade</small>
        </div>
      ) : null}
    </section>
  );
}
