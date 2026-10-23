import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { Bulletin, Disease } from "./domain";

export type PublicPostRow = {
  id: string;
  slug: string;
  title: string;
  approximate_location: string;
  disease: Disease;
  diseases?: Disease[];
  assessment_label: Bulletin["severity"];
  summary: string;
  recommended_actions: string;
  limitations: string | null;
  published_at: string;
  updated_at: string;
  correction_note: string | null;
  media: Bulletin["media"] | null;
  cover_url: string | null;
  reviewer_name: string | null;
  approximate_lat: number | null;
  approximate_lng: number | null;
  revision: number;
  advisory_sources?: Bulletin["advisory_sources"];
};

export function toBulletin(row: PublicPostRow): Bulletin {
  const media = Array.isArray(row.media) ? row.media : [];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    location: row.approximate_location,
    disease: row.disease,
    diseases: row.diseases,
    severity: row.assessment_label,
    body: [row.summary, row.limitations].filter(Boolean).join("\n\n"),
    action: row.recommended_actions,
    date: row.published_at,
    status: "published",
    image: row.cover_url || media[0]?.url || "",
    media,
    reviewer: row.reviewer_name,
    lat: row.approximate_lat,
    lng: row.approximate_lng,
    published_at: row.published_at,
    updated_at: row.updated_at,
    revision: row.revision,
    advisory_sources: Array.isArray(row.advisory_sources) ? row.advisory_sources : [],
  };
}

export function bulletinMapPoint(item: Bulletin) {
  const approvedPhoto = item.media?.find((entry) => entry.type === "image")?.url || item.image;
  return {
    id: item.id,
    lat: item.lat!,
    lng: item.lng!,
    name: item.title,
    location: item.location,
    severity: item.severity,
    diseases: item.diseases?.length ? item.diseases : [item.disease],
    image: approvedPhoto || undefined,
    href: `/advisories/${item.slug}`,
  };
}

export function usePublicPosts(filters?: {
  disease?: string;
  location?: string;
  date?: string;
  limit?: number;
}) {
  const [items, setItems] = useState<Bulletin[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = filters?.limit || 12;
  const filterKey = JSON.stringify(filters || {});

  const fetchPage = async (after?: string | null, append = false) => {
    if (!supabaseConfigured) {
      setItems([]);
      setError("We couldn't load field advisories right now. Please check back later.");
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = supabase
      .from("rg_public_posts")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(limit + 1);
    if (after) query = query.lt("published_at", after);
    if (filters?.disease && filters.disease !== "all")
      query = query.contains("diseases", [filters.disease]);
    if (filters?.location)
      query = query.ilike("approximate_location", `%${filters.location}%`);
    if (filters?.date) query = query.gte("published_at", filters.date);
    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError("Published advisories could not be loaded. Please try again.");
      setLoading(false);
      return;
    }
    const rows = (data || []) as PublicPostRow[];
    const page = rows.slice(0, limit).map(toBulletin);
    setItems((current) => (append ? [...current, ...page] : page));
    setHasMore(rows.length > limit);
    setCursor(page.at(-1)?.published_at || null);
    setError("");
    setLoading(false);
  };

  useEffect(() => {
    void fetchPage(null, false);
    // Filters are serialized so object identity does not refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return {
    items,
    error,
    loading,
    hasMore,
    loadMore: () => fetchPage(cursor, true),
  };
}
