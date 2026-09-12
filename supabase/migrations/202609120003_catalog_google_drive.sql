-- Lumeo remote catalogue. Files remain in Google Drive and are delivered only
-- through the BFF after authorization; this database stores metadata only.

alter table public.profiles add column if not exists is_admin boolean not null default false;

create table if not exists public.catalog_storage_accounts (
  id text primary key,
  provider text not null check (provider in ('google-drive')),
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_books (
  book_id uuid primary key,
  title text not null,
  author text not null default 'Autor desconhecido',
  genre_id text not null default 'sem-genero',
  genre_name text not null default 'Sem gênero',
  cover_url text,
  description text,
  format text not null check (format in ('pdf', 'epub')),
  file_size bigint check (file_size is null or file_size > 0),
  drive_file_id text not null,
  storage_account_id text not null references public.catalog_storage_accounts(id),
  sha256 text,
  volume text,
  collection text,
  language text,
  status text not null default 'PROCESSING' check (status in ('ACTIVE', 'UNAVAILABLE', 'PROCESSING', 'INVALID', 'ERROR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_account_id, drive_file_id)
);

create unique index if not exists catalog_books_sha256_unique
  on public.catalog_books (sha256) where sha256 is not null;
create index if not exists catalog_books_active_updated_idx on public.catalog_books (status, updated_at desc);
create index if not exists catalog_books_genre_idx on public.catalog_books (genre_id);
create index if not exists catalog_books_author_idx on public.catalog_books (author);
create index if not exists catalog_books_collection_idx on public.catalog_books (collection);

create table if not exists public.catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  storage_account_id text not null references public.catalog_storage_accounts(id),
  initiated_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  duplicate_count integer not null default 0,
  failure_count integer not null default 0,
  unavailable_count integer not null default 0,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'FAILED'))
);

alter table public.catalog_storage_accounts enable row level security;
alter table public.catalog_books enable row level security;
alter table public.catalog_sync_runs enable row level security;
-- No browser policies: only the BFF service key reads/writes catalogue tables.

drop trigger if exists catalog_storage_accounts_updated_at on public.catalog_storage_accounts;
create trigger catalog_storage_accounts_updated_at before update on public.catalog_storage_accounts
for each row execute function public.set_updated_at();
drop trigger if exists catalog_books_updated_at on public.catalog_books;
create trigger catalog_books_updated_at before update on public.catalog_books
for each row execute function public.set_updated_at();

insert into public.catalog_storage_accounts (id, provider, display_name)
values ('google-drive-default', 'google-drive', 'Google Drive principal')
on conflict (id) do nothing;

-- Promote an administrator deliberately in the SQL editor after confirming email:
-- update public.profiles set is_admin = true where email = 'admin@example.com';
