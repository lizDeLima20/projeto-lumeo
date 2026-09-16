-- Cross-device library state only. Original PDF/EPUB/LIMA bytes remain in each
-- device's private storage and are never written to Supabase.
alter table public.user_library_books
  add column if not exists source_updated_at timestamptz not null default now();

update public.user_library_books
  set source_updated_at = updated_at
  where source_updated_at is null;

create index if not exists user_library_books_user_source_updated_idx
  on public.user_library_books (user_id, source_updated_at desc);

-- Direct browser access is optional; if used, an authenticated user can only
-- read that user's metadata. Writes remain BFF/service-role operations.
drop policy if exists "user_library_books_select_own" on public.user_library_books;
create policy "user_library_books_select_own"
  on public.user_library_books for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences for select to authenticated
  using (auth.uid() = user_id);
