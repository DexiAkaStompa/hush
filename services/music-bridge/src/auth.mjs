import { createClient } from "@supabase/supabase-js";
import { config } from "./config.mjs";

const supabase = config.supabase.url && config.supabase.publishableKey
  ? createClient(config.supabase.url, config.supabase.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;

const verifiedTokens = new Map();

function bearerToken(request) {
  const value = request.headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export async function authenticateToken(token) {
  if (!token) return null;
  if (config.sharedSecret && token === config.sharedSecret) return { id: null, mode: "shared" };
  if (!supabase) return null;

  const cached = verifiedTokens.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  verifiedTokens.set(token, { user: { id: data.user.id, mode: "supabase" }, expiresAt: Date.now() + 60_000 });
  return { id: data.user.id, mode: "supabase" };
}

export function authenticateSharedToken(token) {
  return Boolean(config.sharedSecret && token && token === config.sharedSecret);
}

export async function authenticateRequest(request) {
  return authenticateToken(bearerToken(request));
}

export function tokenFromRequest(request) {
  return bearerToken(request);
}
