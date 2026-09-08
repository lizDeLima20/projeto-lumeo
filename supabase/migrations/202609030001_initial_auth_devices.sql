create extension if not exists pgcrypto;

create type public.license_status as enum ('active', 'inactive');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status public.license_status not null default 'inactive',
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_hash text not null,
  device_name varchar(80) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, device_token_hash)
);

create unique index devices_one_active_per_user
  on public.devices (user_id) where is_active = true;

alter table public.profiles enable row level security;
alter table public.licenses enable row level security;
alter table public.devices enable row level security;

-- No browser-facing policies: these tables are accessed only by the BFF service role.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger licenses_updated_at before update on public.licenses
for each row execute function public.set_updated_at();

create or replace function public.replace_active_device(
  target_user_id uuid,
  new_device_token_hash text,
  new_device_name text
) returns public.devices
language plpgsql security definer set search_path = public as $$
declare created_device public.devices;
begin
  update public.devices
    set is_active = false, revoked_at = now()
    where user_id = target_user_id and is_active = true;
  insert into public.devices (user_id, device_token_hash, device_name, is_active)
    values (target_user_id, new_device_token_hash, left(new_device_name, 80), true)
    on conflict (user_id, device_token_hash) do update
      set device_name = excluded.device_name, is_active = true,
          last_seen_at = now(), revoked_at = null
    returning * into created_device;
  return created_device;
end;
$$;

revoke all on function public.replace_active_device(uuid, text, text) from public, anon, authenticated;
grant execute on function public.replace_active_device(uuid, text, text) to service_role;
