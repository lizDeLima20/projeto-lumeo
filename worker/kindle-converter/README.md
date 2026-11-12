# Worker de conversão Kindle (EPUB → AZW3)

O worker roda num container Docker próprio, nunca dentro de uma função da Vercel. A cada ciclo ele:

1. Lê as pastas do catálogo no Google Drive do mesmo jeito que o catálogo lê, com os mesmos IDs de livro. A pasta Autoajuda vem primeiro.
2. Põe na fila (`kindle_editions`, no Supabase) os EPUBs novos e os que mudaram: arquivo, sha256, título, autor, capa ou sinopse.
3. Converte um livro de cada vez com o Calibre (`ebook-convert`). Título, autor, idioma, sinopse e capa do catálogo vão para dentro do AZW3.
4. Confere o resultado antes de salvar:
   - EPUB válido (não uma página HTML do Drive);
   - capítulos com caminho quebrado reparados;
   - nenhum capítulo perdido;
   - KF8 de verdade, com título, autor e capa internos.
5. Envia o AZW3 para a pasta **Lumeo Kindle AZW3** do Google Drive e confere o tamanho e o MD5 que o Drive devolve.
6. Grava no banco só o vínculo e marca o livro como pronto. A API do catálogo passa a entregar o AZW3 à extensão do Kindle, sempre atrás do login.

## Onde ficam os arquivos

- **AZW3:** na pasta **Lumeo Kindle AZW3**, na raiz do Drive da conta dona do catálogo. O worker cria a pasta se ela não existir e a compartilha como "qualquer pessoa com o link pode ler", igual aos EPUBs do catálogo.
- **EPUBs originais:** ficam onde estão e não são alterados.
- **Banco** (`kindle_editions`):
  - o vínculo com o livro (`book_id`) e com o EPUB de origem (`epub_drive_file_id`);
  - o ID do AZW3 no Drive (`drive_file_id`);
  - o checksum (`sha256`), o tamanho (`size_bytes`) e o formato (`format`).

  Nenhum arquivo vai para o Supabase.
- **Download:** `GET /api/opds/livros/:id/download?formato=kindle`, com o mesmo login de sempre, responde 302 para o arquivo do Drive.
- **Livro alterado no catálogo:** é reconvertido, e o arquivo novo **substitui o conteúdo** do mesmo arquivo do Drive, que mantém o ID. O worker nunca apaga nem duplica arquivos.

O worker entra no Drive com o escopo `drive.file`. Com ele, só enxerga e altera o que ele mesmo criou: a pasta e os AZW3. Os EPUBs, as HQs e o resto do Drive ficam fora do alcance dele. Uma conta de serviço não serve aqui, porque não tem espaço próprio num Drive pessoal.

## Antes da primeira vez

1. **Banco:** aplique a migração `supabase/migrations/202611120001_kindle_editions.sql`. Ela cria a tabela e a função `claim_kindle_edition`.
2. **Cliente OAuth do Google:**
   - no Google Cloud Console, no mesmo projeto do Lumeo, vá em *APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth*;
   - escolha o tipo **App para computador**;
   - a *Google Drive API* precisa estar ativada no projeto;
   - na *Tela de consentimento OAuth*, deixe o app **Em produção**. Em "Teste", o Google invalida o token em 7 dias. Para o escopo `drive.file`, não é preciso verificação.
3. **`.env` do worker:**
   ```
   cp worker/kindle-converter/env.example worker/kindle-converter/.env
   ```
   Preencha:
   - `SUPABASE_URL`;
   - `SUPABASE_SECRET_KEY`;
   - `KINDLE_DRIVE_CLIENT_ID`;
   - `KINDLE_DRIVE_CLIENT_SECRET`.
4. **Autorização no Drive** (uma vez só, neste computador):
   ```
   npm run worker:kindle:drive-auth
   ```
   - Abra o endereço que aparecer.
   - Entre com a conta Google dona do catálogo e clique em **Permitir**.

   O token é gravado no `.env`, sem aparecer na tela, e a pasta **Lumeo Kindle AZW3** é criada.

## Rodar

Na raiz do repositório:

```
docker compose -f worker/kindle-converter/docker-compose.yml up -d --build
docker compose -f worker/kindle-converter/docker-compose.yml logs -f
```

Outros modos, sem Docker (precisam do Calibre instalado e de `CALIBRE_BIN` apontando para ele):

```
npm run worker:kindle -- --drive-check                   # só confere o login e a pasta do Drive
npm run worker:kindle -- --once                          # varre, converte tudo e sai
npm run worker:kindle -- --dry-run --limit 5             # converte 5 livros sem gravar no Supabase nem no Drive
KINDLE_DRY_RUN_DIR=/tmp/azw3 npm run worker:kindle -- --dry-run --books bk_abc,bk_def
```

## Falhas

- **Drive fora do ar** (login revogado, cota, limite de uso, Google instável): o livro volta para a fila sem gastar tentativa. O worker espera 1 minuto, depois 2, 4 e assim por diante, até 30 minutos, antes de tentar de novo. Se o log mostrar `drive-auth`, rode `npm run worker:kindle:drive-auth` outra vez.
- **Falha passageira** (download do EPUB, rede, arquivo recusado pelo Drive): o livro volta para a fila, até 3 tentativas.
- **Falha definitiva** (EPUB corrompido, Calibre falhou): o livro é marcado como `failed`, e o motivo fica em `last_error`.

## Acompanhar

```sql
select status, count(*) from kindle_editions group by status;
select book_id, metadata->>'title', last_error from kindle_editions where status = 'failed';
select book_id, drive_file_id, size_bytes, sha256 from kindle_editions where status = 'ready' limit 20;
-- tentar de novo um livro que falhou:
update kindle_editions set status = 'pending', attempts = 0 where book_id = '...';
```
