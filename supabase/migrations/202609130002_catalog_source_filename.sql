-- Preserve the original Drive filename for the final legacy identity check.
-- SHA-256 and byte size remain the authoritative content identity fields.
alter table public.catalog_books
  add column if not exists source_file_name text;

comment on column public.catalog_books.source_file_name is
  'Original Google Drive file name; used only after signature, hash and size validation are unavailable.';
