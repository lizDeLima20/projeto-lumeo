-- Catalogue genre folders registered from the admin screen ("Fontes do catálogo").
-- Each row is a Google Drive folder holding books/, covers/ and catalog.json; the
-- folder name shown to readers is `genre`. Only metadata lives here: book and cover
-- bytes stay in Google Drive and reach the reader's browser directly.

-- Self-contained: production may not have the earlier catalogue migration applied, and the
-- admin screen needs both of these.
alter table public.profiles add column if not exists is_admin boolean not null default false;
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create table if not exists public.catalog_sources (
  id uuid primary key default gen_random_uuid(),
  genre text not null check (char_length(btrim(genre)) between 1 and 80),
  drive_folder_url text not null,
  folder_id text not null check (folder_id ~ '^[A-Za-z0-9_-]{10,}$'),
  locale text not null default 'pt-BR',
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_sources_folder_unique on public.catalog_sources (folder_id);
create unique index if not exists catalog_sources_genre_unique on public.catalog_sources (locale, lower(btrim(genre)));

alter table public.catalog_sources enable row level security;
-- No browser policies: only the BFF service key reads/writes catalogue tables.

drop trigger if exists catalog_sources_updated_at on public.catalog_sources;
create trigger catalog_sources_updated_at before update on public.catalog_sources
for each row execute function public.set_updated_at();

-- The two genre folders that were previously registered in code.
insert into public.catalog_sources (genre, drive_folder_url, folder_id)
values
  ('Artes e música', 'https://drive.google.com/drive/folders/1Yc2qLF5v5j163qtkqK0pnwKxL-uERNF0', '1Yc2qLF5v5j163qtkqK0pnwKxL-uERNF0'),
  ('Administração e economia', 'https://drive.google.com/drive/folders/1ObXreEgmEAQGwjKW7-ImnlX92YZ9VcNj', '1ObXreEgmEAQGwjKW7-ImnlX92YZ9VcNj')
on conflict do nothing;

-- Grant the admin screen to an account deliberately, in the SQL editor:
-- update public.profiles set is_admin = true where email = 'admin@example.com';
