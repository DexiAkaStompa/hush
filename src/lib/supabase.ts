import { createClient } from "@supabase/supabase-js";
import { preparePendingMigrationAuth } from "./migration-auth-storage";

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const migrationAuthStorage = preparePendingMigrationAuth(projectUrl);

export const isSupabaseConfigured = Boolean(projectUrl && publishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(projectUrl, publishableKey, {
      auth: {
        ...(migrationAuthStorage ? { storage: migrationAuthStorage } : {}),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    })
  : null;
