# Lumeo — Production Checklist

## Ambiente

- [ ] `APP_ENV=production`
- [ ] `APP_VERSION` definido para a versão do release
- [ ] `APP_BASE_URL` aponta para o domínio HTTPS final
- [ ] `BFF_BASE_URL` aponta para `/api` ou domínio BFF HTTPS
- [ ] `SUPABASE_URL` configurado no backend
- [ ] `SUPABASE_PUBLISHABLE_KEY` configurado no backend quando necessário
- [ ] `SUPABASE_SECRET_KEY` existe somente no backend
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` configurado no frontend
- [ ] Nenhuma variável `VITE_` contém `sb_secret_*`
- [ ] `DEVICE_HASH_SECRET` forte e exclusivo de produção

## Supabase

- [ ] Auth habilitado para signup/login/refresh
- [ ] RLS habilitado em `profiles`, `devices`, `licenses`
- [ ] Políticas impedem acesso a dados de outro usuário
- [ ] Índices revisados: `user_id`, `device_hash`, `status`, `event_id`, `created_at`
- [ ] Backups do Supabase configurados

## Deploy

- [ ] SPA fallback para `index.html`
- [ ] `/api/health` responde sem revelar secrets
- [ ] `/api/ready` responde status seguro
- [ ] Service Worker publicado na raiz
- [ ] Manifest servido com cache correto
- [ ] Headers de segurança aplicados
- [ ] CORS limitado ao domínio de produção

## PWA/offline

- [ ] App instala no Chrome/Edge Android/Desktop
- [ ] App abre offline
- [ ] Biblioteca local aparece offline
- [ ] Livro importado abre offline
- [ ] Cache temporário pode ser limpo sem remover livros
- [ ] Atualização não recarrega Reader sem consentimento

## Produto

- [ ] Licença ativa validada online pelo backend
- [ ] Grace offline validado por período finito
- [ ] Um dispositivo ativo por usuário conforme política atual
- [ ] Troca/revogação de dispositivo testada
- [ ] Gateway de pagamento escolhido antes de habilitar checkout

## Diagnóstico

- [ ] Diagnóstico não inclui conteúdo de livro
- [ ] Diagnóstico não inclui notas/grifos
- [ ] Logs não incluem tokens, senhas ou service role
- [ ] Smoke test final executado no domínio real
