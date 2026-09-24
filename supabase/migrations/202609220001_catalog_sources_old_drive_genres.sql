-- Four more genre folders from the original catalogue Drive ("Lumeo Catalogo"). Each holds
-- books/, covers/ and catalog.json; only the catalog metadata is read by the BFF, book and
-- cover bytes stay in Google Drive. Turismo e guia de viagem has its own migration
-- (202609200001). Existing genres are not touched: rows are matched by folder_id.
insert into public.catalog_sources (genre, drive_folder_url, folder_id, locale, enabled)
values
  ('Biografia e memórias', 'https://drive.google.com/drive/folders/1vNg2upKWB05bncYQxEgU-NwoFz-IMxvd', '1vNg2upKWB05bncYQxEgU-NwoFz-IMxvd', 'pt-BR', true),
  ('Ciências', 'https://drive.google.com/drive/folders/1c7SjN6VWKXxZtLJT37VqQ9znRwKziBxM', '1c7SjN6VWKXxZtLJT37VqQ9znRwKziBxM', 'pt-BR', true),
  ('Concurso público', 'https://drive.google.com/drive/folders/1OD1Ec1EKFBw3WLrdArAyO_f5SLJcRogQ', '1OD1Ec1EKFBw3WLrdArAyO_f5SLJcRogQ', 'pt-BR', true),
  ('Contos e crônicas', 'https://drive.google.com/drive/folders/1UyRzozIiHQScxnd311QlGFOG4W04ZYtG', '1UyRzozIiHQScxnd311QlGFOG4W04ZYtG', 'pt-BR', true)
on conflict (folder_id) do update
set
  genre = excluded.genre,
  drive_folder_url = excluded.drive_folder_url,
  locale = excluded.locale,
  enabled = excluded.enabled,
  updated_at = now();
