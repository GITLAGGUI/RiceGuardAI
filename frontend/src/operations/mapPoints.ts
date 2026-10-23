import type { MapPoint } from "./Map";

export function groupMapPoints(points: MapPoint[]) {
  const groups = new Map<string, {key:string;lat:number;lng:number;points:MapPoint[]}>();
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat)>90 || Math.abs(point.lng)>180) continue;
    const key=`${point.lat}:${point.lng}`;
    const group=groups.get(key) || {key,lat:point.lat,lng:point.lng,points:[]};
    group.points.push(point);groups.set(key,group);
  }
  return [...groups.values()];
}
export function publicMapSummary(posts:number,locations:number) {
  return posts ? `${posts} mapped ${posts===1?"post":"posts"} · ${locations} approximate ${locations===1?"location":"locations"}` : "No approved public locations yet.";
}
// Cluster only the display at the current zoom, retaining a real member's pin.
// Saved coordinates never move. Zooming in separates nearby distinct areas.
export function clusterMapPoints(points:MapPoint[],project:(lat:number,lng:number)=>{x:number;y:number},distance=36) {
 const clusters:ReturnType<typeof groupMapPoints>=[];
 for(const group of groupMapPoints(points)) {
  const p=project(group.lat,group.lng);
  const near=clusters.find(c=>{const q=project(c.lat,c.lng);return Math.hypot(p.x-q.x,p.y-q.y)<distance;});
  if(near)near.points.push(...group.points);else clusters.push({...group,points:[...group.points]});
 }
 return clusters;
}
