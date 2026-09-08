import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProfileStore { ensure(userId: string, email: string): Promise<void>; }

export class ProfileRepository implements ProfileStore {
  public constructor(private readonly database: SupabaseClient) {}
  public async ensure(userId: string, email: string): Promise<void> {
    const { error } = await this.database.from("profiles").upsert(
      { user_id: userId, email }, { onConflict: "user_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }
}
