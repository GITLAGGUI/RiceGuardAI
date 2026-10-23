import { describe, expect, it } from "vitest";
import { groupMapPoints, publicMapSummary, clusterMapPoints } from "./mapPoints";

describe("approved map locations", () => {
  it("groups near pins only at display zoom and separates them without changing GPS",()=>{
    const points=[{id:'a',lat:17.6,lng:121.7},{id:'b',lat:17.601,lng:121.701}] as any;
    const before=JSON.stringify(points);
    expect(clusterMapPoints(points,(lat,lng)=>({x:lng*1000,y:lat*1000}))).toHaveLength(1);
    expect(clusterMapPoints(points,(lat,lng)=>({x:lng*100000,y:lat*100000}))).toHaveLength(2);
    expect(JSON.stringify(points)).toBe(before);
  });
  it("keeps coincident posts together without moving their approved coordinates", () => {
    const points = [{id:"older",lat:17.25,lng:121.7,severity:"moderate"}, {id:"latest",lat:17.25,lng:121.7,severity:"unknown"}, {id:"other",lat:18,lng:122,severity:"low"}] as any;
    const groups=groupMapPoints(points);
    expect(groups).toHaveLength(2);
    expect(groups[0].points.map(p=>p.id)).toEqual(["older","latest"]);
    expect(groups[0].lat).toBe(17.25);
    expect(points[1].lng).toBe(121.7);
  });
  it("does not coerce missing or invalid GPS into a pin", () => {
    expect(groupMapPoints([{id:"missing",lat:null,lng:null},{id:"invalid",lat:100,lng:121},{id:"nan",lat:NaN,lng:121}] as any)).toHaveLength(0);
  });
  it("distinguishes post counts from distinct map positions", () => {
    expect(publicMapSummary(6,3)).toBe("6 mapped posts · 3 approximate locations");
    expect(publicMapSummary(0,0)).toBe("No approved public locations yet.");
  });
});
