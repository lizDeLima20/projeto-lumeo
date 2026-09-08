-- Production RLS/index hardening for the real Lumeo Supabase project.
-- Browser clients may read only their own rows. Mutations remain BFF/service-role only.

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.licenses enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "devices_select_own" on public.devices;
create policy "devices_select_own"
  on public.devices
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "licenses_select_own" on public.licenses;
create policy "licenses_select_own"
  on public.licenses
  for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists profiles_user_id_idx on public.profiles (user_id);
create index if not exists profiles_created_at_idx on public.profiles (created_at);

create index if not exists devices_user_id_idx on public.devices (user_id);
create index if not exists devices_user_hash_idx on public.devices (user_id, device_token_hash);
create index if not exists devices_last_seen_at_idx on public.devices (last_seen_at);
create index if not exists devices_created_at_idx on public.devices (created_at);

create index if not exists licenses_user_id_idx on public.licenses (user_id);
create index if not exists licenses_status_idx on public.licenses (status);
create index if not exists licenses_created_at_idx on public.licenses (created_at);
