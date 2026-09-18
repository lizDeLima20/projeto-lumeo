-- Two more genre folders, registered in the same catalogue source table as the others.
-- Each folder holds books/, covers/ and catalog.json; its books come only from that catalog.json.
-- Autoajuda is deliberately absent: its upload is still in progress.
insert into public.catalog_sources (genre, drive_folder_url, folder_id)
values
  ('Aventura', 'https://drive.google.com/drive/folders/1D-qr4sz_TKbN2Niyc_1tEWntXNe_sTdY', '1D-qr4sz_TKbN2Niyc_1tEWntXNe_sTdY'),
  ('Desenvolvimento pessoal', 'https://drive.google.com/drive/folders/1DAiKsBMy3BgScLH8fsbBAXdXW1rW1pCm', '1DAiKsBMy3BgScLH8fsbBAXdXW1rW1pCm')
on conflict do nothing;
