# Modal de bibliotecas Google Drive

A tela `/import` mostra somente Do dispositivo e Google Drive como fontes
principais. O botão Google Drive abre um `<dialog>` nativo, sem depender de
refresh de sessão nem carregar a API Google para cadastrar fontes.

Nome e link são solicitados somente dentro da modal. Após salvar, apenas o nome
fica visível. O botão + cadastra outra fonte. Toque prolongado (550 ms, cancelado
por movimento), clique direito ou ⋯ abrem Renomear, Alterar link e Excluir.
O armazenamento usa IndexedDB por usuário; excluir uma fonte não toca nos livros.
O acesso OneDrive existente continua em Configurações.

## API e download

Ativar Google Drive API no projeto Google Cloud e configurar um cliente OAuth Web
com as origens JavaScript do Lumeo. Configurar `VITE_GOOGLE_CLIENT_ID` no build.
Sem configuração, cadastrar/editar/excluir continua funcionando; ao abrir uma
fonte aparece “Google Drive ainda não está configurado.”

Ao abrir fonte configurada, o app carrega Google Identity Services e oferece um
botão explícito de conexão. Tokens ficam apenas na memória. A listagem usa a
Drive API v3 com filtro do folderId salvo, arquivos não excluídos, paginação e
suporte a subpastas/resource keys. Links de arquivos não são aceitos como fontes.

O fluxo por link arbitrário solicita `drive.readonly`: esse escopo permite leitura
ampla e pode exigir verificação Google para produção. `drive.file` do Picker antigo
não concede automaticamente acesso a toda pasta cujo link foi colado. Nenhuma
permissão de escrita é solicitada e nenhum livro é enviado ao backend.

Referências oficiais:

- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
- https://developers.google.com/identity/oauth2/web/guides/use-token-model

PDF/EPUB são baixados diretamente por `alt=media`, com cancelamento, timeout e
limite de 256 MiB. Passam pelo ImportManager, verificação de duplicata, capa e
metadados, usando a prévia existente e persistência local na confirmação.
LIMA é listado como indisponível: o importador de origem atual aceita PDF/EPUB.

## Refresh separado

Sessão vencida sem refresh token é limpa antes de disparar request. Refresh
inválido é tratado pelo AuthManager, que limpa a sessão. Sessão local válida
não dispara refresh. A modal não faz chamadas à autenticação da BFF.

## Validação

- `npm run build`: TypeScript + frontend + backend.
- `npm test`: 534 testes, incluindo nove novos de fontes/API/refresh.
- Chrome 412×915: dois seletores, modal, validação de link, duas fontes, reload,
  aviso não configurado, toque prolongado, renomear, alterar link, excluir e
  ausência de overflow/exceções de JavaScript.
- Teste reproduzível: `tests/browser/google-drive-libraries.mjs`, com Vite local
  iniciado e Playwright disponível. Usa contexto isolado e mocks somente para
  sessão/device/licença; não usa credenciais reais.

UX local: PASS. OAuth, download de uma pasta real e deploy: não validados nesta
etapa. Não confundir os testes locais com aprovação da integração em produção.

## Arquivos desta correção

- src/external/GoogleDriveLibraryRepository.ts
- src/external/GoogleDriveLibraryService.ts
- src/views/GoogleDriveLibrariesModal.ts
- src/views/BookImportView.ts
- src/services/AuthManager.ts
- src/i18n/ExternalLibraryTranslations.ts
- src/styles/components.css
- vercel.json
- tests/GoogleDriveLibraries.test.ts
- tests/browser/google-drive-libraries.mjs
