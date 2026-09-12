import type { SupabaseClient } from "@supabase/supabase-js";
import type { LicenseRecord, LicenseStatus } from "../types/domain.js";

export interface LicenseStore {
  findByUser(userId: string): Promise<LicenseRecord | null>;
  createDevelopmentLicense(userId: string): Promise<LicenseRecord>;
}

export class LicenseRepository implements LicenseStore {
  public constructor(private readonly database: SupabaseClient) {}
  public async findByUser(userId: string): Promise<LicenseRecord | null> {
    const { data, error } = await this.database.from("licenses").select("id,user_id,status,purchased_at")
      .eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data ? { id: data.id, userId: data.user_id, status: data.status as LicenseStatus, purchasedAt: data.purchased_at } : null;
  }
  public async createDevelopmentLicense(userId: string): Promise<LicenseRecord> {
    // The explicit temporary development switch must also release accounts
    // that were created before it was enabled, not only brand-new accounts.
    const { data, error } = await this.database.from("licenses").upsert({ user_id: userId, status: "active" }, { onConflict: "user_id" })
      .select("id,user_id,status,purchased_at").single();
    if (error) throw error;
    return { id: data.id, userId: data.user_id, status: data.status as LicenseStatus, purchasedAt: data.purchased_at };
  }
}
