import { supabase } from "@/lib/supabase";
import type { Disease, Severity } from "@/types/database";

export interface DraftDetection {
  disease: Disease;
  severity: Severity;
  lat: number;
  lng: number;
  location_text?: string;
  confidence_score?: number;
}

/**
 * Atomically creates a scan + N detections via the RPC.
 * Returns the new scan id and detection ids.
 */
export async function createScanWithDetections(
  scan: {
    scan_name: string;
    source_type?: string;
    stored_path?: string | null;
    captured_at?: string | null;
  },
  detections: DraftDetection[]
): Promise<{ scan_id: string; detection_ids: string[] }> {
  const { data, error } = await supabase.rpc("create_scan_with_detections", {
    p_scan: scan,
    p_detections: detections,
  });
  if (error) throw error;
  const result = data as { scan_id: string; detection_ids: string[] };
  return result;
}

/**
 * For each detection, find the nearest active farmer and return them.
 * Used by the post-save advisory generation flow.
 */
export async function findNearbyFarmers(
  lat: number,
  lng: number,
  radiusKm = 10
) {
  const { data, error } = await supabase.rpc("find_nearby_farmers", {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
  });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    full_name: string;
    phone: string;
    barangay: string | null;
    municipality: string | null;
    province: string | null;
    distance_km: number;
  }>;
}

/** Calls the generate-advisory Edge Function to draft + insert one advisory. */
export async function generateAdvisory(
  detectionId: string,
  farmerId: string,
  skipAi = false
) {
  const { data, error } = await supabase.functions.invoke("generate-advisory", {
    body: { detection_id: detectionId, farmer_id: farmerId, skip_ai: skipAi },
  });
  if (error) throw error;
  return data as { advisory_id: string; model: string; advice_preview: string };
}
