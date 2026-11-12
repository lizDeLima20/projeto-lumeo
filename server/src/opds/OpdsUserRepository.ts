import type { SupabaseClient } from "@supabase/supabase-js";

export interface OpdsUser { id: string; username: string; passwordHash: string; active: boolean; }

/** What the catalog keeps about its readers. Only the server reaches it (service role). */
export interface OpdsStore {
  findUser(username: string): Promise<OpdsUser | null>;
  /** Failed sign-ins since `since` for this username from this address, and from this address at all. */
  failures(username: string, ip: string, since: Date): Promise<{ forUser: number; forIp: number }>;
  recordFailure(username: string, ip: string): Promise<void>;
  downloadsSince(userId: string, since: Date): Promise<number>;
  recordDownload(userId: string, bookId: string): Promise<void>;
}

/** opds_users, opds_login_attempts and opds_downloads (supabase/migrations/*_opds.sql). */
export class OpdsUserRepository implements OpdsStore {
  public constructor(private readonly database: SupabaseClient) {}

  public async findUser(username: string): Promise<OpdsUser | null> {
    const { data, error } = await this.database.from("opds_users").select("id,username,password_hash,ativo").eq("username", username).maybeSingle();
    if (error) throw error;
    return data ? { id: data.id, username: data.username, passwordHash: data.password_hash, active: data.ativo === true } : null;
  }

  public async failures(username: string, ip: string, since: Date): Promise<{ forUser: number; forIp: number }> {
    const after = since.toISOString();
    const [user, address] = await Promise.all([
      this.database.from("opds_login_attempts").select("id", { count: "exact", head: true }).eq("username", username).eq("ip", ip).gte("data", after),
      this.database.from("opds_login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("data", after),
    ]);
    if (user.error) throw user.error; if (address.error) throw address.error;
    return { forUser: user.count ?? 0, forIp: address.count ?? 0 };
  }

  public async recordFailure(username: string, ip: string): Promise<void> {
    const { error } = await this.database.from("opds_login_attempts").insert({ username: username.slice(0, 120), ip: ip.slice(0, 64) });
    if (error) throw error;
  }

  public async downloadsSince(userId: string, since: Date): Promise<number> {
    const { count, error } = await this.database.from("opds_downloads").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("data", since.toISOString());
    if (error) throw error; return count ?? 0;
  }

  public async recordDownload(userId: string, bookId: string): Promise<void> {
    const { error } = await this.database.from("opds_downloads").insert({ user_id: userId, livro_id: bookId });
    if (error) throw error;
  }
}
