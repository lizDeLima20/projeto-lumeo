# Catálogo “Explorar livros”

O catálogo é remoto; a biblioteca do leitor continua local-first. A BFF guarda
somente metadados no Supabase e, quando o leitor escolhe **Adicionar à biblioteca**,
retorna a URL pública do arquivo no Google Drive. O navegador baixa o PDF/EPUB
diretamente do Drive; a BFF nunca faz streaming do arquivo. O PDF/EPUB então passa pelo
mesmo `ImportManager`, validação, capa extraída e IndexedDB usados pela importação
do dispositivo. Depois disso, ele funciona offline e não depende mais do Drive.

## Configuração de produção

1. Execute `supabase/migrations/202609120003_catalog_google_drive.sql` no SQL
   Editor do projeto Supabase.
2. Crie uma service account no Google Cloud, habilite Google Drive API e
   compartilhe **apenas** a pasta do catálogo com o e-mail dessa service account.
3. Configure somente no ambiente da BFF/Vercel:
   - `GOOGLE_CATALOG_FOLDER_ID`
   - `GOOGLE_CATALOG_SERVICE_ACCOUNT_JSON` (JSON completo ou base64 do JSON)
   - `CATALOG_SYNC_MAX_FILE_BYTES`
4. Promova de propósito um perfil administrador com o `update` comentado na
   migração. O frontend não decide quem é administrador.

Nenhuma dessas variáveis pode usar o prefixo `VITE_`, entrar no Git ou ser
mostrada em logs. O cliente só chama `/api/catalog/*` com o token da sessão.

## Operação

- `GET /api/catalog/books`: lista paginada e filtrável por metadados.
- `GET /api/catalog/books/:bookId`: detalhe.
- `GET /api/catalog/books/:bookId/download`: devolve JSON com metadados e a URL
  pública de download do Drive; não transmite bytes do PDF/EPUB.
- `POST /api/catalog/sync`: ação explícita, autenticada e restrita a
  `profiles.is_admin = true`. Nunca é executada no carregamento da aplicação.

A rota interna `/catalog-admin` oferece o botão de sincronização após o backend
confirmar `is_admin`; ela não aparece na navegação comum e uma conta normal é
recusada também pelo endpoint.

Durante a sincronização a BFF calcula SHA-256 e valida os bytes iniciais. O
nome do arquivo é apenas uma sugestão para título/autor; títulos iguais não são
considerados duplicados. Um arquivo ausente no Drive vira `UNAVAILABLE`, sem
apagar cópias já instaladas nos dispositivos.

Capas de EPUB/PDF baixados são sempre extraídas localmente do próprio arquivo
pelo `CoverService`. Para cards remotos, `cover_url` poderá ser preenchido por
um processo editorial autorizado; sem uma capa previamente preparada, o Lumeo
mostra um placeholder elegante e nunca usa thumbnail do Google Drive.
