-- Autoajuda: its Drive folder now has books/, covers/ and catalog.json, so it joins the
-- other genre sources. Its books come only from its own catalog.json.
insert into public.catalog_sources (genre, drive_folder_url, folder_id)
values ('Autoajuda', 'https://drive.google.com/drive/folders/1Pqu3DcMJT8wTwC7pFX7e20Z9fPUDJBoZ', '1Pqu3DcMJT8wTwC7pFX7e20Z9fPUDJBoZ')
on conflict do nothing;
