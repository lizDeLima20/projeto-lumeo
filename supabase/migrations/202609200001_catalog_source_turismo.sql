-- Official structured source for Turismo e guia de viagem.  The Lumeo BFF
-- reads only catalog.json metadata; book and cover bytes remain in Google
-- Drive and continue directly to the reader's device.
insert into public.catalog_sources (genre, drive_folder_url, folder_id, locale, enabled)
values (
  'Turismo e guia de viagem',
  'https://drive.google.com/drive/folders/1QYs_64VSDXg6RVMx7zjGA-Sp0c1Pvbrk',
  '1QYs_64VSDXg6RVMx7zjGA-Sp0c1Pvbrk',
  'pt-BR',
  true
)
on conflict (folder_id) do update
set
  genre = excluded.genre,
  drive_folder_url = excluded.drive_folder_url,
  locale = excluded.locale,
  enabled = excluded.enabled,
  updated_at = now();
