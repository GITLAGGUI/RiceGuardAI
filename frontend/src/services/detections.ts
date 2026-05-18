import { supabase } from "@/lib/supabase";
import type { DiseaseDetection } from "@/types/database";

export async function listDetections(opts?: { farmerId?: string; limit?: number }) {
  let q = supabase
    .from("disease_detections")
    .select("*")
    .order("created_at", { ascending: false });
  if (opts?.farmerId) q = q.eq("farmer_id", opts.farmerId);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DiseaseDetection[];
}

export async function listAllDetections(limit = 500) {
  const { data, error } = await supabase
    .from("disease_detections")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DiseaseDetection[];
}
