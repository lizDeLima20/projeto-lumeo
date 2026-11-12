-- Kindle editions: the AZW3 (or, when AZW3 is not possible, PDF) that the conversion worker
-- (worker/kindle-converter, a Docker container outside Vercel) makes from each catalog EPUB.
--
-- kindle_editions is both the queue and the record: the worker finds the catalog's EPUBs in
-- Google Drive (read exactly as the catalog reads them), adds one row per book, claims rows one
-- at a time with claim_kindle_edition(), converts with Calibre and stores the file in the
-- private bucket kindle-editions. The BFF lists ready rows and answers downloads with a signed,
-- short-lived address. Nothing here changes the catalog, its Drive files or the OPDS logins.
--
-- Only the service role reaches the table, the function and the bucket: RLS is on with no
-- policy, and the browser keys (anon/authenticated) are revoked.

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
  storage_path text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  sha256 text,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  locked_by text,
  locked_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A ready edition always has its file.
  constraint kindle_editions_ready_has_file check (status <> 'ready' or (format is not null and storage_path is not null and size_bytes is not null))
);
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

-- Private bucket: no storage policy, so only the service role reads and writes it; readers get
-- signed addresses from the BFF. The size per file is the project's global limit.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('kindle-editions', 'kindle-editions', false, array['application/vnd.amazon.mobi8-ebook', 'application/pdf'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
