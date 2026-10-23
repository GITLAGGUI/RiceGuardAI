import { createClient } from "@supabase/supabase-js";
import { createConnectorStore } from "../_shared/geminiConnector/store.ts";
import { createConnectorHandler } from "../_shared/geminiConnector/server.ts";
import { createEvidenceMediaReader } from "../_shared/geminiConnector/media.ts";
import { createVisualMediaReader } from "../_shared/geminiConnector/visualMedia.ts";
import { resolveReadyEvent } from "../_shared/geminiConnector/readyEvents.ts";
import {
  ConnectorError,
  json,
  randomToken,
} from "../_shared/geminiConnector/policy.ts";
import { awsSettings, signedAwsPost } from "../_shared/awsSigV4.ts";

// No Gemini API key. Credentials remain server-side and grants remain private.
const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ownerId = Deno.env.get("RG_GEMINI_CONNECTOR_OWNER_ID");
const enabled = Deno.env.get("RG_GEMINI_CONNECTOR_ENABLED") === "true";
const handler = url && serviceKey && ownerId && enabled
  ? (() => {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const store = createConnectorStore(admin);
    const mediaInput = {
      store,
      allowedHosts: (Deno.env.get("RG_GEMINI_MEDIA_HOSTS") || "").split(",")
        .map((h) => h.trim()).filter(Boolean),
      sign: async (
        payload: {
          action: "signed-pinned-review";
          job_id: string;
          run_id: string;
          paths: string[];
        },
      ) => {
        const response = await signedAwsPost(
          JSON.stringify(payload),
          awsSettings(),
        );
        if (!response.ok) throw new ConnectorError("media_unavailable", 503);
        return await response.json();
      },
    };
    const media = createEvidenceMediaReader(mediaInput);
    return createConnectorHandler({
      store,
      media,
      visual: Deno.env.get("RG_GEMINI_VISUAL_MEDIA_ENABLED") === "true"
        ? createVisualMediaReader(mediaInput)
        : undefined,
      events: Deno.env.get("RG_GEMINI_VISUAL_MEDIA_ENABLED") === "true" &&
          Deno.env.get("RG_GEMINI_READY_EVENTS_ENABLED") === "true"
        ? { resolve: (context, id) => resolveReadyEvent(context, id, store) }
        : undefined,
      ownerId,
      origin: "https://riceguardai.dev",
      now: () => new Date(),
      randomToken,
      verifyAdmin: async (jwt) => {
        const user = await admin.auth.getUser(jwt);
        if (user.error || !user.data.user) {
          throw new ConnectorError("invalid_session", 401);
        }
        const verified = await admin.auth.getClaims(jwt);
        if (
          verified.error || verified.data?.claims.sub !== user.data.user.id ||
          verified.data.claims.aal !== "aal2"
        ) {
          throw new ConnectorError(
            "access_denied",
            403,
            "Administrator MFA required",
          );
        }
        const profile = await admin.from("profiles").select("role,is_active")
          .eq("id", user.data.user.id).single();
        if (
          profile.error || profile.data?.role !== "admin" ||
          profile.data.is_active !== true
        ) {
          throw new ConnectorError("access_denied", 403);
        }
        return {
          id: user.data.user.id,
          role: "admin",
          is_active: true,
          aal: "aal2",
        };
      },
    });
  })()
  : null;

Deno.serve((req) =>
  handler ? handler(req) : json({ error: "connector_disabled" }, 503)
);
