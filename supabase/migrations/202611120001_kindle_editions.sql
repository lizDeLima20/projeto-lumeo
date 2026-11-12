-- Kindle editions: the AZW3 (or, when AZW3 is not possible, PDF) that the conversion worker
-- (worker/kindle-converter, a Docker container outside Vercel) makes from each catalog EPUB.
--
-- kindle_editions is both the queue and the record: the worker finds the catalog's EPUBs in
-- Google Drive (read exactly as the catalog reads them), adds one row per book, claims rows one
-- at a time with claim_kindle_edition(), converts with Calibre and uploads the AZW3 to the Google
-- Drive folder "Lumeo Kindle AZW3" (the original EPUBs are never touched). This table keeps only
-- the link: the converted file's Drive id, its checksum, size and format, and the book/EPUB it
-- comes from. The BFF lists ready rows and answers an (authenticated) download by sending the
-- reader to that Drive file, exactly as it already does with the catalog's own EPUBs. Nothing
-- here changes the catalog, its Drive files or the OPDS logins. No file is kept in Supabase.
--
-- Only the service role reaches the table and the function: RLS is on with no policy, and the
-- browser keys (anon/authenticated) are revoked.

create table if not exists public.kindle_editions (
  book_id text primary key,
  source_id text not null,
  -- Lower first: the Autoajuda folder is converted before any other.
  priority integer not null default 100,
  -- The EPUB this edition comes from; a different file or checksum queues the book again.
  epub_drive_file_id text not null,
  epub_sha256 text,
  -- Title, author, language, synopsis, cover... as the catalog has them, for the file's metadata.
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  format text check (format in ('azw3', 'pdf')),
  -- The converted file in the Drive folder "Lumeo Kindle AZW3"; a new conversion of the same
  -- book replaces this file's content, so the id stays the same.
  drive_file_id text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  locked_by text,
  locked_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A ready edition always has its file.
  constraint kindle_editions_ready_has_file check (status <> 'ready' or (format is not null and drive_file_id is not null and size_bytes is not null and sha256 is not null))
);
create unique index if not exists kindle_editions_drive_file on public.kindle_editions (drive_file_id) where drive_file_id is not null;
create index if not exists kindle_editions_queue on public.kindle_editions (status, priority, created_at);
create index if not exists kindle_editions_source on public.kindle_editions (source_id);

alter table public.kindle_editions enable row level security;
revoke all on public.kindle_editions from anon, authenticated;

-- Hands the next book to a worker. Several workers never get the same book (skip locked); a
-- book left "processing" by a worker that died is handed out again after p_stale_after, and
-- one that keeps failing stops after p_max_attempts.
create or replace function public.claim_kindle_edition(p_worker text, p_max_attempts integer default 3, p_stale_after interval default interval '30 minutes')
returns setof public.kindle_editions
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.kindle_editions
     set status = 'failed', last_error = left(coalesce(last_error || ' | ', '') || 'conversão interrompida (tempo esgotado)', 2000),
         locked_by = null, locked_at = null, updated_at = now()
   where status = 'processing' and locked_at < now() - p_stale_after and attempts >= p_max_attempts;

  return query
  update public.kindle_editions as edition
     set status = 'processing', locked_by = p_worker, locked_at = now(), attempts = edition.attempts + 1, updated_at = now()
   where edition.book_id = (
           select candidate.book_id from public.kindle_editions as candidate
            where (candidate.status = 'pending' or (candidate.status = 'processing' and candidate.locked_at < now() - p_stale_after))
              and candidate.attempts < p_max_attempts
            order by candidate.priority, candidate.created_at, candidate.book_id
            for update skip locked
            limit 1)
  returning edition.*;
end;
$$;
revoke all on function public.claim_kindle_edition(text, integer, interval) from public, anon, authenticated;
grant execute on function public.claim_kindle_edition(text, integer, interval) to service_role;
