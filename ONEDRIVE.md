# Bibliotecas OneDrive conectadas

## Estado

Implementação local; validação real Microsoft/OneDrive **PENDENTE MANUAL**.
Não foi realizado deploy nesta etapa. Sem Client ID configurado, a interface
informa que a conexão precisa ser configurada; não simula autenticação.

## Configuração

Registrar um aplicativo Microsoft Entra com plataforma **Single-page application**.
Para contas pessoais e organizacionais, escolher os tipos de conta correspondentes
e usar tenant `common` (ou o tenant específico da organização).
Cadastrar exatamente os redirects dos ambientes utilizados:

- `http://localhost:5173/onedrive-auth.html`
- `https://lumeo-livros.vercel.app/onedrive-auth.html`

Configurar no ambiente do build, sem client secret:

```dotenv
VITE_ONEDRIVE_ENABLED=true
VITE_MICROSOFT_CLIENT_ID=identificador-publico-do-aplicativo
VITE_MICROSOFT_TENANT_ID=common
```

Esses identificadores são públicos. Nunca colocar secrets Microsoft/Supabase
em variáveis VITE. A autenticação utiliza MSAL com popup e cache em memória.
Recarregar a aplicação exige reconexão; não são persistidos tokens nas fontes.

O endpoint oficial de resolução de compartilhamentos `/shares` documenta
`Files.ReadWrite` como menor permissão delegada suportada. A aplicação solicita
esse escopo, não `Files.ReadWrite.All`, e implementa somente operações GET.
Consentimento pode depender das políticas do tenant. Não existe garantia de acesso
anônimo: tenta-se a resolução pública e, se exigida, solicita-se conexão Microsoft.

Referências oficiais:

- https://learn.microsoft.com/en-us/graph/api/shares-get?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization

## Fluxo e armazenamento

`ExternalLibrariesPanel` permite salvar, abrir, editar, reconectar e remover fontes
nas configurações/importação. `OneDriveSourceRepository` salva configurações na
IndexedDB por usuário usando `ExternalLibraryStorage`. Links de compartilhamento
podem conferir acesso: ficam somente nesse armazenamento local e não são logados.
Remover uma fonte não remove livros já importados.

`OneDriveFolderResolver` resolve links oficiais pelo Graph; `OneDriveBrowserService`
lista subpastas e páginas adicionais. Não incorpora nem extrai HTML do site OneDrive.
PDF e EPUB são importáveis. LIMA aparece indisponível nesta integração.

`OneDriveDownloadService` obtém uma URL temporária nova ao selecionar o arquivo.
O download acontece diretamente no navegador, sem BFF e sem encaminhar o Bearer
token à URL assinada. Há limite de 256 MiB, timeout, progresso, cancelamento e
checagem de tamanho recebido. URLs de paginação/download têm validação de domínio.

`OneDriveImportCoordinator` reutiliza `ImportManager`, validação do arquivo, hash,
metadados, `CoverService` e análise de capacidade PDF. A prévia não salva um livro.
O usuário pode revisar os metadados antes de confirmar. Duplicados exatos são
bloqueados; versões seguem a decisão já existente na importação.

Na confirmação, o arquivo original e a capa são persistidos localmente. PDF sem
texto continua disponível mesmo quando a conversão LIMA não produz conteúdo.
A importação registra a operação no `OperationRecoveryJournal`; cancelamento ou
erro durante a gravação remove os artefatos daquele novo livro. Operações
interrompidas abruptamente mantêm registro para diagnóstico/recuperação existente.
Não há upload de PDF/EPUB ao Supabase. A leitura posterior utiliza o arquivo local.

## Verificação manual obrigatória antes de PASS

1. Configurar Client ID/redirects e recompilar.
2. Adicionar duas fontes reais, recarregar e verificar isolamento entre usuários.
3. Conectar conta pessoal e/ou organizacional admitida pelo registro.
4. Abrir pasta, subpasta, paginação, arquivo PDF e EPUB.
5. Confirmar prévia, capa extraída e leitura offline após importação.
6. Tentar duplicado, cancelar download e confirmar ausência de livro incompleto.
7. Testar link inválido/revogado, pasta sem permissão e sessão expirada.
8. Renomear e remover fonte, preservando livros importados.

Testes automatizados: `tests/OneDriveImport.test.ts`, além de `npm run build`
e `npm test`. Mocks validam contratos e recuperação, não substituem autenticação
e download reais no navegador.
