import { lazy, Suspense, type ComponentProps } from "react";
import type { FieldMap as MapComponent } from "./Map";
const Map = lazy(() => import("./Map").then(m => ({ default: m.FieldMap })));
export function FieldMap(props: ComponentProps<typeof MapComponent>) {
  return <Suspense fallback={<div className="rg-map rg-empty" role="status">Loading Region II map…</div>}><Map {...props} /></Suspense>;
}
