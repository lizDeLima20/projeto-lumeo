# Lumeo — Security Checklist

## Secrets

- [ ] Service role key ausente do frontend/bundle
- [ ] Secrets existem apenas em variáveis de ambiente do backend
- [ ] Logs sanitizam tokens, senhas, notas, grifos e conteúdo de livros

## Auth e licença

- [ ] Login/signup/refresh possuem rate limit
- [ ] Token expirado exige refresh ou reautenticação
- [ ] Frontend não consegue ativar licença permanentemente
- [ ] Backend/Supabase é fonte de verdade da licença
- [ ] Grace offline é finito e configurável

## CORS e headers

- [ ] CORS sem wildcard em produção
- [ ] `Content-Security-Policy` aplicado
- [ ] `X-Content-Type-Options=nosniff`
- [ ] `Referrer-Policy` aplicado
- [ ] `Permissions-Policy` aplicado
- [ ] HSTS habilitado em HTTPS de produção

## XSS e conteúdo externo

- [ ] Metadata de livros usa `textContent`
- [ ] EPUB/LIMA tratado como não confiável
- [ ] Scripts e iframes removidos de EPUB
- [ ] URLs `javascript:` bloqueadas
- [ ] HTML externo nunca é executado

## Arquivos, ZIP e backup

- [ ] PDF validado por assinatura `%PDF`
- [ ] EPUB/ZIP validado por assinatura `PK`
- [ ] ZIP traversal bloqueado
- [ ] ZIP bomb limitado por arquivos, bytes expandidos e razão
- [ ] Backup validado antes de tocar no banco
- [ ] Backup nunca executa conteúdo

## Webhooks

- [ ] Assinatura HMAC obrigatória
- [ ] `eventId` idempotente
- [ ] Replays duplicados ignorados
- [ ] Payload validado antes de alterar licença

## Privacidade

- [ ] Livros permanecem locais
- [ ] Dados de estudo permanecem locais por padrão
- [ ] Dicionário/pesquisa usa apenas seleção explícita
- [ ] Diagnóstico exclui dados privados do Reader
