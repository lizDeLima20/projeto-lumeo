# Lumeo — Release Checklist

1. [ ] `npm run typecheck`
2. [ ] `npm run typecheck:server`
3. [ ] `npm test`
4. [ ] `npm run build`
5. [ ] Validar bundle sem secrets
6. [ ] Executar fluxo E2E: onboarding/login/importar/abrir/grifar/anotar/fechar/reabrir
7. [ ] Executar E2E de PDF escaneado: Image Reader, preset, zoom, pan, RegionHighlight
8. [ ] Executar E2E de backup: criar, exportar, restaurar em base limpa
9. [ ] Executar E2E de update: Reader aberto, update disponível, aceitar e retomar posição
10. [ ] Testar PWA instalada online/offline
11. [ ] Limpar cache temporário e confirmar livros/grifos/notas/progresso
12. [ ] Testar migração IndexedDB sem reset
13. [ ] Testar auth real Supabase: signup/login/refresh/logout
14. [ ] Testar licença ativa, expirada, revogada e grace offline
15. [ ] Validar CORS em domínio permitido e origem desconhecida
16. [ ] Validar `/api/health` e `/api/ready`
17. [ ] Rodar checklist de segurança
18. [ ] Publicar em staging
19. [ ] Smoke test em staging
20. [ ] Publicar produção
21. [ ] Smoke test produção

## Smoke test produção

- [ ] App abre sem tela branca
- [ ] Login funciona
- [ ] Biblioteca aparece
- [ ] Importação local funciona
- [ ] Reader abre e salva progresso
- [ ] Caderno/fichário persistem
- [ ] Offline continua leitura local
- [ ] Reconnect não perde sessão
- [ ] Logout/login preserva biblioteca local do usuário
- [ ] Diagnóstico copia JSON seguro
