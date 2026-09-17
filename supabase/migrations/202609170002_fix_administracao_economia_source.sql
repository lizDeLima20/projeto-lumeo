-- Correct the seed used before the folder link was confirmed.  This is metadata
-- only: the Lumeo BFF reads catalog.json and returns direct Google Drive URLs;
-- no EPUB/PDF bytes pass through Supabase or the BFF.
update public.catalog_sources
set
  drive_folder_url = 'https://drive.google.com/drive/folders/1ObXreEgmEAQGwjKW7-ImnlX92YZ9VcNj',
  folder_id = '1ObXreEgmEAQGwjKW7-ImnlX92YZ9VcNj',
  enabled = true,
  updated_at = now()
where locale = 'pt-BR'
  and lower(btrim(genre)) = lower('Administração e economia');
