// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "@/types/database";
import { ProtectedRoute } from "@/components/guards/ProtectedRoute";
import { Login } from "@/pages/public/Login";
import { GeminiConnectionPage } from "./GeminiConnection";
import {
  connectorOwnerAction,
  googleConnectorCallback,
  safeAdminReturnPath,
} from "./geminiConnector";

const fixtures = vi.hoisted(() => ({
  auth: {
    session: { access_token: "synthetic-admin-session" } as Session | null,
    profile: { role: "admin", is_active: true } as Profile | null,
    loading: false,
    profileLoading: false,
    aal: "aal2" as "aal1" | "aal2" | null,
    refreshAal: vi.fn(async () => {}),
  },
  getSession: vi.fn(),
  getAal: vi.fn(),
  listFactors: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => fixtures.auth }));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: {
    getSession: fixtures.getSession,
    mfa: {
      getAuthenticatorAssuranceLevel: fixtures.getAal,
      listFactors: fixtures.listFactors,
      challenge: fixtures.challenge,
      verify: fixtures.verify,
    },
  } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const requestId = "11111111-1111-4111-8111-111111111111";
const pendingUrl = `/admin/connect/gemini?request=${requestId}`;
const callback = "https://oauth-redirect.googleusercontent.com/r/synthetic-client?code=synthetic-code&state=synthetic-state";
let calls: { action: string; body: Record<string, unknown>; headers: Headers }[];
let respond: (action: string, body: Record<string, unknown>) => Promise<Response>;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function preview(overrides: Record<string, unknown> = {}) {
  return {
    app_name: "RiceGuardAI Advisory",
    scopes: ["evidence:read", "advisory:submit"],
    expires_at: new Date(Date.now() + 240_000).toISOString(),
    eligible_surveys: [{ id: "survey-fixture", label: "Private fixture survey" }],
    ...overrides,
  };
}
function mount(url = pendingUrl, guarded = false) {
  const router = createMemoryRouter([
    ...(guarded ? [{ element: <ProtectedRoute role="admin" />, children: [{ path: "/admin/connect/gemini", element: <GeminiConnectionPage /> }] }] : [{ path: "/admin/connect/gemini", element: <GeminiConnectionPage /> }]),
    { path: "/login", element: <Login /> },
    { path: "/admin/overview", element: <p>Admin overview</p> },
  ], { initialEntries: [url] });
  render(<RouterProvider router={router} />);
  return router;
}
function mountLogin(from: string) {
  const router = createMemoryRouter([
    { path: "/login", element: <Login /> },
    { path: "/admin/connect/gemini", element: <p>Pending Gemini consent</p> },
    { path: "/admin/overview", element: <p>Admin overview</p> },
  ], { initialEntries: [{ pathname: "/login", state: { from } }] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  fixtures.auth.session = { access_token: "synthetic-admin-session" } as Session;
  fixtures.auth.profile = { role: "admin", is_active: true } as Profile;
  fixtures.auth.aal = "aal2";
  fixtures.getSession.mockResolvedValue({ data: { session: fixtures.auth.session }, error: null });
  fixtures.getAal.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
  fixtures.listFactors.mockResolvedValue({ data: { totp: [{ id: "synthetic-factor", status: "verified" }] }, error: null });
  fixtures.challenge.mockResolvedValue({ data: { id: "synthetic-challenge" }, error: null });
  fixtures.verify.mockResolvedValue({ data: {}, error: null });
  respond = async (action) => action === "preview" ? json(preview()) : action === "grants" ? json({ grants: [] }) : json({ redirect_uri: callback });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const action = input.split("/").at(-1)!;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ action, body, headers: new Headers(init.headers) });
    return respond(action, body);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("owner action boundary", () => {
  it("posts only the requested owner action with the current admin bearer", async () => {
    await connectorOwnerAction("preview", { request_id: requestId });
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("preview");
    expect(calls[0].body).toEqual({ request_id: requestId });
    expect(calls[0].headers.get("Authorization")).toBe("Bearer synthetic-admin-session");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/advisory-oauth/owner/preview");
  });
  it("refuses a missing session before making any owner request", async () => {
    fixtures.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(connectorOwnerAction("consent", {})).rejects.toThrow(/sign in/i);
    expect(calls).toEqual([]);
  });
  it("treats a server owner or MFA denial as failure", async () => {
    respond = async () => json({ error: "owner_required", message: "Connector owner with MFA required." }, 403);
    await expect(connectorOwnerAction("consent", {})).rejects.toThrow("Connector owner with MFA required.");
  });
  it.each([
    "javascript:alert(1)",
    "https://gemini.google.com/callback",
    "https://oauth-redirect.googleusercontent.com.evil.invalid/r/client",
    "https://user@oauth-redirect.googleusercontent.com/r/client",
    "https://oauth-redirect.googleusercontent.com:444/r/client",
    "https://oauth-redirect.googleusercontent.com/r/client#fragment",
  ])("rejects a foreign or unsafe callback: %s", (url) => {
    expect(() => googleConnectorCallback(url)).toThrow();
  });
  it("accepts only the approved Google callback origin and path", () => {
    expect(googleConnectorCallback(callback)).toBe(callback);
  });
});

describe("Gemini consent", () => {
  it("shows the exact app, scopes, request expiry and duration with images off and no mutation on load", async () => {
    mount();
    await screen.findByRole("checkbox", { name: /Private fixture survey/ });
    expect(screen.getByRole("heading", { name: "RiceGuardAI Advisory" })).toBeTruthy();
    expect(screen.getByText("evidence:read")).toBeTruthy();
    expect(screen.getByText("advisory:submit")).toBeTruthy();
    expect(screen.getByText(/at most 30 days/i)).toBeTruthy();
    expect(screen.getByText(/Request expires/i)).toBeTruthy();
    expect(screen.getByText(/Hindi ito magpa-publish o magpapadala ng SMS/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Share sanitized evidence images/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.map((call) => call.action)).toEqual(["preview"]);
  });
  it("requires selected evidence and sends text-only permission once despite double clicking Allow", async () => {
    let finish: (value: Response) => void = () => {};
    respond = async (action) => action === "consent" ? new Promise((resolve) => { finish = resolve; }) : json(preview());
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("checkbox", { name: /Private fixture survey/ }));
    await user.dblClick(screen.getByRole("button", { name: "Allow" }));
    expect(calls.filter((call) => call.action === "consent").map((call) => call.body)).toEqual([
      { request_id: requestId, decision: "allow", survey_ids: ["survey-fixture"], allow_images: false },
    ]);
    expect((screen.getByRole("button", { name: /Saving/ }) as HTMLButtonElement).disabled).toBe(true);
    finish(json({ error: "temporary_failure", message: "Please retry later." }, 503));
    await screen.findByRole("alert");
    expect(screen.queryByText(/connected successfully/i)).toBe(null);
  });
  it("requires an explicit image opt-in and retains it after an unsuccessful save", async () => {
    respond = async (action) => action === "consent" ? json({ error: "owner_required", message: "Owner verification failed." }, 403) : json(preview());
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("checkbox", { name: /Private fixture survey/ }));
    await user.click(screen.getByRole("checkbox", { name: /Share sanitized evidence images/ }));
    await user.click(screen.getByRole("button", { name: "Allow" }));
    await screen.findByText("Owner verification failed.");
    expect(calls.find((call) => call.action === "consent")?.body.allow_images).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Share sanitized evidence images/ }) as HTMLInputElement).checked).toBe(true);
  });
  it("denies without selecting evidence or granting images", async () => {
    respond = async (action) => action === "consent" ? json({ redirect_uri: "https://evil.invalid/callback" }) : json(preview());
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    await screen.findByRole("alert");
    expect(calls.find((call) => call.action === "consent")?.body).toEqual({
      request_id: requestId, decision: "deny", survey_ids: [], allow_images: false,
    });
    expect(screen.getByRole("alert").textContent).toMatch(/callback/i);
  });
  it("asks to restart an expired request and blocks Allow", async () => {
    respond = async () => json(preview({ expires_at: "2020-01-01T00:00:00Z" }));
    mount();
    await screen.findByText(/Restart the connection from Gemini/i);
    expect(screen.queryByRole("button", { name: "Allow" })).toBe(null);
    expect(calls.some((call) => call.action === "consent")).toBe(false);
  });
  it("shows server-side expiry with a restart instruction", async () => {
    respond = async () => json({ error: "expired_request", message: "The request expired." }, 400);
    mount();
    await screen.findByText(/Restart the connection from Gemini/i);
    expect(screen.queryByRole("button", { name: "Allow" })).toBe(null);
  });
  it("does not offer consent when the server rejects an apparently signed-in administrator", async () => {
    respond = async () => json({ error: "owner_required", message: "Connector owner with MFA required." }, 403);
    mount();
    await screen.findByText("Connector owner with MFA required.");
    expect(screen.queryByRole("button", { name: "Allow" })).toBe(null);
    expect(screen.queryByRole("button", { name: "Register client" })).toBe(null);
  });
});

describe("connection management", () => {
  it("shows expiry and immediately marks a successfully revoked grant", async () => {
    respond = async (action) => action === "grants" ? json({ grants: [{
      id: "grant-one", app_name: "RiceGuardAI Advisory", scopes: ["evidence:read", "advisory:submit"],
      allow_images: false, expires_at: new Date(Date.now() + 86_400_000).toISOString(), revoked_at: null, survey_ids: ["survey-fixture"],
    }] }) : json({ revoked: true });
    const user = userEvent.setup();
    mount("/admin/connect/gemini");
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await screen.findByText("Revoked");
    expect(screen.queryByRole("button", { name: "Revoke" })).toBe(null);
    expect(calls.find((call) => call.action === "revoke")?.body).toEqual({ grant_id: "grant-one" });
    expect(screen.getByText(/Expires/)).toBeTruthy();
    expect(screen.getByText(/Images: off/)).toBeTruthy();
  });
  it("creates no client until explicit submit and keeps the one-time secret out of persistent storage", async () => {
    respond = async (action) => action === "register-client" ? json({ client_id: "synthetic-client-id", client_secret: "synthetic-once-only-secret" }) : json({ grants: [] });
    const user = userEvent.setup();
    const localStore = vi.spyOn(Storage.prototype, "setItem");
    mount("/admin/connect/gemini");
    await screen.findByRole("button", { name: "Register client" });
    expect(calls.map((call) => call.action)).toEqual(["grants"]);
    await user.type(screen.getByLabelText("Client name"), "RiceGuardAI Advisory");
    await user.type(screen.getByLabelText("Exact Google callback URL"), "https://oauth-redirect.googleusercontent.com/r/synthetic-client");
    await user.click(screen.getByRole("button", { name: "Register client" }));
    await screen.findByText("synthetic-once-only-secret");
    expect(localStore).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain("synthetic-once-only-secret");
    expect(calls.find((call) => call.action === "register-client")?.body).toEqual({
      client_name: "RiceGuardAI Advisory", redirect_uri: "https://oauth-redirect.googleusercontent.com/r/synthetic-client",
    });
    await user.click(screen.getByRole("button", { name: "Hide credentials" }));
    expect(screen.queryByText("synthetic-once-only-secret")).toBe(null);
    localStore.mockRestore();
  });
});

describe("login and MFA return", () => {
  it("preserves the pending request when the guard sends an anonymous user to login", async () => {
    fixtures.auth.session = null;
    fixtures.auth.profile = null;
    const router = mount(pendingUrl, true);
    await screen.findByRole("heading", { name: "RiceGuardAI Admin" });
    expect(router.state.location.state).toEqual({ from: pendingUrl });
    expect(calls).toEqual([]);
  });
  it("preserves the pending request when the guard requires MFA", async () => {
    fixtures.auth.aal = "aal1";
    const router = mount(pendingUrl, true);
    await screen.findByRole("heading", { name: "RiceGuardAI Admin" });
    expect(router.state.location.state).toEqual({ from: pendingUrl, requireMfa: true });
    expect(calls).toEqual([]);
  });
  it("returns an already verified owner to the pending request", async () => {
    const router = mountLogin(pendingUrl);
    await screen.findByText("Pending Gemini consent");
    expect(router.state.location.pathname + router.state.location.search).toBe(pendingUrl);
  });
  it("returns to the pending request after the authenticator is verified", async () => {
    fixtures.auth.aal = "aal1";
    const router = mountLogin(pendingUrl);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /I already have a password/ }));
    const code = await screen.findByRole("textbox");
    fireEvent.change(code, { target: { value: "123456" } });
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    await screen.findByText("Pending Gemini consent");
    expect(router.state.location.pathname + router.state.location.search).toBe(pendingUrl);
  });
  it("falls back to overview for a malicious login return target", async () => {
    mountLogin("https://evil.invalid/steal");
    await screen.findByText("Admin overview");
  });
  it.each(["//evil.invalid", "/admin/connect/gemini?request=x&returnTo=https://evil.invalid", "/admin/connect/gemini?request=bad%0Avalue", "/admin/connect/gemini/../../login", "/admin\\evil.invalid"])("rejects unsafe pending return %s", (value) => {
    expect(safeAdminReturnPath(value)).toBe("/admin/overview");
  });
  it("keeps the exact opaque request and normal known admin destinations", () => {
    expect(safeAdminReturnPath(pendingUrl)).toBe(pendingUrl);
    expect(safeAdminReturnPath("/admin/review")).toBe("/admin/review");
  });
});
