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
5. Salva o AZW3 no bucket privado `kindle-editions` e marca o livro como pronto. A API do catálogo passa a oferecer o arquivo à extensão do Kindle, com endereço assinado e temporário.

Livros com falha:

- **Falha passageira** (Drive, rede, armazenamento): o livro volta para a fila, até 3 tentativas.
- **Falha definitiva** (EPUB corrompido, Calibre falhou): o livro é marcado como `failed`, e o motivo fica em `last_error`.

## Antes da primeira vez

Aplique a migração `supabase/migrations/202611120001_kindle_editions.sql` no SQL Editor do Supabase. Ela cria a tabela, a função `claim_kindle_edition` e o bucket privado.

## Rodar

Na raiz do repositório:

```
cp worker/kindle-converter/env.example worker/kindle-converter/.env    # preencha SUPABASE_URL e SUPABASE_SECRET_KEY
docker compose -f worker/kindle-converter/docker-compose.yml up -d --build
docker compose -f worker/kindle-converter/docker-compose.yml logs -f
```

O worker também aceita outros modos, sem Docker (precisa do Calibre instalado e de `CALIBRE_BIN` apontando para ele):

```
npm run worker:kindle -- --once                         # varre, converte tudo e sai
npm run worker:kindle -- --dry-run --limit 5            # converte 5 livros sem gravar nada no Supabase
KINDLE_DRY_RUN_DIR=/tmp/azw3 npm run worker:kindle -- --dry-run --books bk_abc,bk_def
```

## Acompanhar

```sql
select status, count(*) from kindle_editions group by status;
select book_id, metadata->>'title', last_error from kindle_editions where status = 'failed';
-- tentar de novo um livro que falhou:
update kindle_editions set status = 'pending', attempts = 0 where book_id = '...';
```
