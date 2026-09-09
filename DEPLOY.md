# Deploy na Vercel

O projeto combina Vite (`dist`) e um BFF Node HTTP (`server/src/app.ts`).
`api/index.ts` exporta o handler serverless, sem abrir uma porta. A rewrite
`/api/:path*` encaminha rotas simples e aninhadas para esse handler.

Importe a **raiz do repositório**, não `dist` ou `server`. Use o preset Vite,
build `npm run build` e output `dist`, conforme `vercel.json`. Faça deploy do
projeto completo para incluir a função, não somente upload de arquivos estáticos.

Em Settings → Environment Variables, escopo Production, configure:

- `SUPABASE_URL`: URL pública do projeto Supabase.
- `SUPABASE_PUBLISHABLE_KEY`: chave pública do projeto.
- `SUPABASE_SECRET_KEY`: chave privada, somente no backend.
- `DEVICE_HASH_SECRET`: segredo estável para identificação dos dispositivos;
  preserve o valor usado pelo backend existente.
- `APP_ENV=production`
- `NODE_ENV=production`
- `LOCAL_AUTH_MODE=false`
- `AUTO_ACTIVATE_DEV_LICENSE=false`
- `APP_BASE_URL=https://lumeo-livros.vercel.app`
- `BFF_BASE_URL=https://lumeo-livros.vercel.app/api`
- `ALLOWED_ORIGINS=https://lumeo-livros.vercel.app`

Não copie o `.env` de desenvolvimento inteiro para produção. Nunca prefixe
secrets com `VITE_`. O `.env` local não é enviado ao Git nem à Vercel.
Se utilizados pelo frontend, somente `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY` são públicos. A API de produção sempre usa `/api`.
Localmente, `VITE_API_URL` pode sobrescrever `http://localhost:3000/api`.

Depois de cadastrar as variáveis, faça **Redeploy** da versão corrigida.

Validação sem criar contas nem enviar senha:

```sh
curl -i https://lumeo-livros.vercel.app/api/ready
curl -i -H 'Content-Type: application/json' -d '{}' https://lumeo-livros.vercel.app/api/auth/login
curl -i -H 'Content-Type: application/json' -d '{}' https://lumeo-livros.vercel.app/api/auth/signup
```

Readiness deve informar `status: "ok"` e todos os checks `true` (HTTP 200 sozinho
não comprova configuração). Corpos vazios devem retornar erro de validação JSON
do BFF, não o `NOT_FOUND` da Vercel. Valide login real na interface com uma conta
existente; nenhum teste de corpo vazio comprova autenticação bem-sucedida.

## Publicação verificada em 2026-09-09

- Projeto: `delima-dev/lumeo-livros`.
- Deployment: `dpl_BLEP1jGWrbLPF7nWwxnx9a9AAf5L`.
- API pública: `https://lumeo-livros.vercel.app/api`.
- `/api/ready`: HTTP 200, `status: "ok"`, quatro checks verdadeiros.
- `/api/auth/login`: HTTP 401 `AUTH_INVALID_CREDENTIALS` para credenciais
  deliberadamente inválidas. Logs do deploy confirmaram `supabase.auth.error`
  com `invalid_credentials`; a requisição chegou ao Supabase.
- `/api/auth/signup`: HTTP 400 `INVALID_EMAIL` para corpo vazio; rota atendida
  pelo BFF. Nenhuma conta foi criada por esse teste.
- Build local e remoto aprovados; 31 testes do backend e 450 testes restantes
  aprovados na cópia isolada publicada.
- Auditoria do bundle local e do script principal publicado sem valores de
  secrets do backend. Arquivos `.env*` excluídos do upload.

A publicação via CLI incluiu a versão Git base mais as correções da BFF,
sem as mudanças locais pendentes do Reader/estante. As correções de deploy
ainda precisam ser incorporadas ao Git antes de um futuro deploy pela
integração Git; esta publicação não criou commit nem executou push.
Login bem-sucedido de uma conta real e cadastro completo não foram testados.
