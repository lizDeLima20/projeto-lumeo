-- OPDS catalog for KOReader (Kindle): its readers, their failed sign-ins and their downloads.
-- Only the BFF reaches these tables, with the service role key: RLS is on and there is no
-- policy, so the browser keys (anon/authenticated) see nothing. Passwords are bcrypt hashes,
-- created by `npm run opds:user`; no password is ever stored in clear.

create table if not exists public.opds_users (
  id uuid primary key default gen_random_uuid(),
  username text not null check (username = lower(btrim(username)) and char_length(username) between 3 and 120),
  password_hash text not null check (password_hash ~ '^\$2[aby]\$\d{2}\$.{53}$'),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists opds_users_username_unique on public.opds_users (username);

-- Failed sign-ins only (a success records nothing). The catalog refuses a username from an
-- address after 5 failures in 15 minutes, and an address after 20.
create table if not exists public.opds_login_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  ip text not null,
  data timestamptz not null default now()
);
create index if not exists opds_login_attempts_user_ip on public.opds_login_attempts (username, ip, data desc);
create index if not exists opds_login_attempts_ip on public.opds_login_attempts (ip, data desc);

create table if not exists public.opds_downloads (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.opds_users(id) on delete cascade,
  livro_id text not null,
  data timestamptz not null default now()
);
create index if not exists opds_downloads_user_data on public.opds_downloads (user_id, data desc);

alter table public.opds_users enable row level security;
alter table public.opds_login_attempts enable row level security;
alter table public.opds_downloads enable row level security;
-- No policies: only the BFF service key reads and writes these tables.
revoke all on public.opds_users, public.opds_login_attempts, public.opds_downloads from anon, authenticated;
