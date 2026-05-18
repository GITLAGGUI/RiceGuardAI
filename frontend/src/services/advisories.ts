import { supabase } from "@/lib/supabase";
import type { Advisory } from "@/types/database";

export async function listMyAdvisories(farmerId: string) {
  const { data, error } = await supabase
    .from("advisories")
    .select("*")
    .eq("farmer_id", farmerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Advisory[];
}

export async function listAdvisoriesByState(state: "draft" | "approved" | "sent" | "all" = "all") {
  let q = supabase.from("advisories").select("*").order("created_at", { ascending: false });
  if (state !== "all") q = q.eq("state", state);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Advisory[];
}

export async function getAdvisory(id: string) {
  const { data, error } = await supabase
    .from("advisories")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Advisory;
}

export async function updateAdvisory(id: string, patch: Partial<Advisory>) {
  const { error } = await supabase.from("advisories").update(patch).eq("id", id);
  if (error) throw error;
}
