# Lumeo Livros: extensão do KOReader para o Kindle

Esta é a interface do Lumeo dentro do KOReader, num Kindle com jailbreak. A interface da Amazon não é alterada.

- **Tela inicial:** busca por título ou autor, carrossel de gêneros e uma grade de capas 3 × 3 com o título embaixo de cada capa.
- **Tela do livro:** capa grande, título, autor, sinopse, idioma e formato, o botão **Baixar para a biblioteca** e o botão **Voltar**.
- **Download:** o livro em AZW3, convertido pelo worker com capa e metadados dentro do arquivo, vai sempre para `/mnt/us/documents/Lumeo`. Não há escolha de pasta. A biblioteca do próprio Kindle indexa o livro com capa, e os três pontinhos funcionam normalmente.
- **Livros sem AZW3:** EPUB ainda em conversão, conversão que falhou e PDF do catálogo aparecem com o botão desativado e o motivo na tela.

## Instalar

1. Copie a pasta `lumeolivros.koplugin` para `koreader/plugins/` no Kindle, pelo cabo USB.
2. Abra o KOReader e entre no menu de busca (lupa) → **Lumeo Livros** → **Abrir Lumeo Livros**.
3. Na primeira vez, entre com o mesmo usuário e senha do catálogo OPDS. Eles são criados com `npm run opds:user -- add <usuario>`.

O login fica salvo só no Kindle, em `koreader/settings/lumeolivros.lua`. O item **Sair** do menu apaga esse login.

Depois de baixar um livro, feche o KOReader. Ao voltar para a interface do Kindle, o livro aparece na Biblioteca com a capa. A extensão também pede ao Kindle que reindexe a pasta, mas isso precisa ser confirmado no aparelho.

## Testes, sem KOReader e sem Kindle

Na raiz do repositório, rode com qualquer Lua 5.1 ou mais recente, inclusive o `luajit` do KOReader:

```
luajit kindle/tests/run.lua       # lógica: arquivos, nomes, grade, carrossel, validação do AZW3
luajit kindle/tests/screens.lua   # telas e rede sobre stubs do KOReader
```
