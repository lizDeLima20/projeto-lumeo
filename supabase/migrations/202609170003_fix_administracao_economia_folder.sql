-- The original folder link was transcribed incorrectly. Keep existing
-- installations aligned with the verified Drive folder containing books/,
-- covers/ and catalog.json.
update public.catalog_sources
set
  drive_folder_url = 'https://drive.google.com/drive/folders/10bXreEgmEAQGwjKW7-lnnIX92YZ9VcNj',
  folder_id = '10bXreEgmEAQGwjKW7-lnnIX92YZ9VcNj',
  enabled = true,
  updated_at = now()
where locale = 'pt-BR'
  and lower(btrim(genre)) = lower('Administração e economia');
