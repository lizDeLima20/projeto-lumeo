-- Different Drive files may legitimately contain equal bytes (editions,
-- mirrors or separately published volumes). Catalogue identity is Drive id.
drop index if exists public.catalog_books_sha256_unique;
create index if not exists catalog_books_sha256_idx on public.catalog_books (sha256) where sha256 is not null;
