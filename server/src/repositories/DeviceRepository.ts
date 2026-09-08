import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceRecord } from "../types/domain.js";

interface DeviceRow {
  id: string; user_id: string; device_token_hash: string; device_name: string;
  is_active: boolean; created_at: string; last_seen_at: string; revoked_at: string | null;
}

export interface DeviceStore {
  findActiveByUser(userId: string): Promise<DeviceRecord | null>;
  findByHash(userId: string, hash: string): Promise<DeviceRecord | null>;
  create(userId: string, hash: string, name: string): Promise<DeviceRecord>;
  touch(id: string): Promise<void>;
  revokeActive(userId: string): Promise<void>;
  replaceActive(userId: string, hash: string, name: string): Promise<DeviceRecord>;
  countActive(userId: string): Promise<number>;
}

export class DeviceRepository implements DeviceStore {
  public constructor(private readonly database: SupabaseClient) {}

  public async findActiveByUser(userId: string): Promise<DeviceRecord | null> {
    const { data, error } = await this.database.from("devices").select("*")
      .eq("user_id", userId).eq("is_active", true).maybeSingle<DeviceRow>();
    if (error) throw error;
    return data ? this.map(data) : null;
  }

  public async findByHash(userId: string, hash: string): Promise<DeviceRecord | null> {
    const { data, error } = await this.database.from("devices").select("*")
      .eq("user_id", userId).eq("device_token_hash", hash).order("created_at", { ascending: false })
      .limit(1).maybeSingle<DeviceRow>();
    if (error) throw error;
    return data ? this.map(data) : null;
  }

  public async create(userId: string, hash: string, name: string): Promise<DeviceRecord> {
    const { data, error } = await this.database.from("devices").insert({
      user_id: userId, device_token_hash: hash, device_name: name, is_active: true,
    }).select("*").single<DeviceRow>();
    if (error) throw error;
    return this.map(data);
  }

  public async touch(id: string): Promise<void> {
    const { error } = await this.database.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }

  public async revokeActive(userId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.database.from("devices").update({ is_active: false, revoked_at: now })
      .eq("user_id", userId).eq("is_active", true);
    if (error) throw error;
  }

  public async replaceActive(userId: string, hash: string, name: string): Promise<DeviceRecord> {
    const { data, error } = await this.database.rpc("replace_active_device", {
      target_user_id: userId, new_device_token_hash: hash, new_device_name: name,
    }).single<DeviceRow>();
    if (error) throw error;
    return this.map(data);
  }

  public async countActive(userId: string): Promise<number> {
    const { count, error } = await this.database.from("devices").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("is_active", true);
    if (error) throw error;
    return count ?? 0;
  }

  private map(row: DeviceRow): DeviceRecord {
    return { id: row.id, userId: row.user_id, deviceTokenHash: row.device_token_hash,
      deviceName: row.device_name, isActive: row.is_active, createdAt: row.created_at,
      lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at };
  }
}
