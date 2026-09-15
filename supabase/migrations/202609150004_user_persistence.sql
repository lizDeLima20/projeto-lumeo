-- Account-scoped metadata only. Book bytes remain exclusively in each
-- device's OPFS/IndexedDB or Android filesDir storage.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_completed boolean not null default false,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  genres jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_library_books (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  metadata jsonb not null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index if not exists user_library_books_user_updated_idx
  on public.user_library_books (user_id, updated_at desc);

alter table public.user_preferences enable row level security;
alter table public.user_library_books enable row level security;

-- Browser clients have no policies. The BFF service role owns access and
-- always scopes queries with the authenticated user_id.
create trigger user_preferences_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();

create trigger user_library_books_updated_at before update on public.user_library_books
for each row execute function public.set_updated_at();
