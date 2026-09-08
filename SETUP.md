# Configuração do Lumeo

1. O projeto Supabase de produção é `https://rasonfawfsvyfhjkinbp.supabase.co`.
2. No Supabase, abra **Project Settings > API** e copie a chave `publishable` e a chave `secret`.
3. Copie `.env.example` para `.env` e preencha as variáveis. A `SUPABASE_SECRET_KEY` e `DEVICE_HASH_SECRET` são exclusivas do backend e nunca usam prefixo `VITE_`.
4. No **SQL Editor** do Supabase, execute as migrations em ordem:
   - `supabase/migrations/202609030001_initial_auth_devices.sql`
   - `supabase/migrations/202609080002_rls_indexes_prod.sql`
5. Para contas locais receberem licença automaticamente, use `AUTO_ACTIVATE_DEV_LICENSE=true` somente em desenvolvimento.
6. Execute `npm install` e `npm run dev:all`. Frontend: `http://localhost:5173`; BFF: `http://127.0.0.1:3000/api`.

Na Vercel, cadastre as mesmas variáveis privadas no projeto. Defina `VITE_API_URL=/api`, `NODE_ENV=production`, uma lista explícita em `ALLOWED_ORIGINS` e mantenha `AUTO_ACTIVATE_DEV_LICENSE=false`.

## Google Drive

1. No Google Cloud Console, habilite **Google Picker API** e **Google Drive API**.
2. Configure a tela de consentimento OAuth e crie um cliente OAuth para aplicativo Web.
3. Nas origens JavaScript autorizadas, inclua `http://localhost:5173` e o domínio de produção.
4. Crie uma API key restrita às APIs e aos domínios do Lumeo.
5. Preencha `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` e `VITE_GOOGLE_APP_ID` no `.env`.

Esses valores são identificadores públicos do frontend; não use client secret. O Lumeo solicita autorização temporária, não persiste o token e salva o arquivo escolhido diretamente no IndexedDB, sem enviá-lo ao backend.
