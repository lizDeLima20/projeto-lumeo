import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Config, type ServerConfig } from "../config/Config.js";

export class SupabaseService {
  public readonly admin: SupabaseClient;
  public readonly auth: SupabaseClient;

  public constructor(config: ServerConfig) {
    Config.assertSupabase(config);
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    this.admin = createClient(config.supabaseUrl, config.supabaseSecretKey, options);
    this.auth = createClient(config.supabaseUrl, config.supabasePublishableKey, options);
  }
}
