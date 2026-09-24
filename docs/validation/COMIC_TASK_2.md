# Tarefa 2: conversao real de HQ

Validacao em 2026-09-22. Implementacao exclusiva de HQ/manga, sobre a fundacao da tarefa 1.
A qualidade de OCR nao e perfeita: os resultados incertos permanecem identificados para revisao.
Nao foi iniciada a tarefa 3.

## Arquivos

Criados em `src/reader/comic/interaction/`:

- `ComicPdfConverter.ts`: entrada explicita para PDF de HQ/manga, render e liberacao de recursos.
- `ComicTextRegionDetector.ts`: componentes claros delimitados para encontrar caixas/baloes.
- `ComicRegionOcr.ts`: segmentacao, agrupamento espacial, OCR por recorte e status de revisao.
- `ComicConversionCache.ts`: cache IndexedDB separado dos livros, paginas e pacotes concluidos.
- `ComicConversionIdentity.ts`: SHA-256 do arquivo, versao do algoritmo, idioma, resolucao e capas.
- `ComicLimaWriter.ts`: ZIP incremental com imagens ja comprimidas.
- `ComicInteractionDebug.ts`: desenho de bounds, ID e confidence, desligado por padrao.
- `ComicConversionDebugPage.ts`: entrada apenas de desenvolvimento.

Outros arquivos criados:

- `dev/comic-conversion.html`: selecionar PDF, configurar capa, converter, cancelar, baixar e inspecionar bounds.
- `tests/ComicConversion.test.ts`: agrupamento, OCR bruto, cache, retomada, falhas, cancelamento, isolamento de paginas, fitting e debug.
- `scripts/validate-comic-lima.ts`: verifica um pacote real em disco e os hit-tests de todas as regioes.
- Este relatorio.

Alterados da tarefa 1: `ComicConverter.ts`, `ComicInteractionTypes.ts`, `ComicInteractionValidator.ts`,
`ComicLimaDeserializer.ts` e `index.ts`. Tambem: `src/reader/comic/ComicLayout.ts` e
`src/views/ComicReaderView.ts`. As demais alteracoes preexistentes do workspace foram preservadas.
`ComicInteractionEngine` nao precisou ser reescrito.

## Pipeline e reconhecimento

`ComicPdfConverter.convert({ contentType: "comic", blob, title })` e a entrada real.
`contentType: "manga"` tambem e aceito; `book` e recusado. A conversao e explicita,
nao disparada automaticamente a cada abertura do leitor.

PDF.js renderiza sequencialmente com lado maior de 2400 pixels. A pagina colorida completa
e codificada em WebP (PNG quando o navegador nao suporta WebP). So depois o canvas
descartavel vira escala de cinza para OCR. Nao ha crop da arte, reconstrucao nem tratamento generativo.

A deteccao combina componentes claros conectados com a segmentacao esparsa do Tesseract.
Caixas pequenas delimitadas sao mantidas inteiras; fundos claros maiores sao subdivididos por
coluna, alinhamento e distancia entre linhas. O limiar usa a altura de uma linha,
nao a altura acumulada de um bloco, para evitar unir falas de personagens diferentes.
Texto fora de caixas claras tambem pode gerar candidatos. Duplicatas com sobreposicao sao
resolvidas antes de expor os dados ao hit-test.

Tesseract.js 7 / WebAssembly usa os assets `por` ja empacotados no projeto, em worker local.
A segunda passagem reconhece recortes individuais com borda branca. Nao envia paginas para servicos externos.
Referencia da API: https://github.com/naptha/tesseract.js/blob/master/docs/api.md

O texto bruto e preservado, incluindo erros. Confidence e normalizada de 0 a 1.
`recognitionStatus: "needs-review"` sinaliza confidence abaixo de 0.85, palavras abaixo de 60/100,
resultado curto/vazio ou limite visual nao verificado. O status `recognized` expressa a evidencia
do OCR, nao uma garantia de transcricao humana correta. Tipo/shape sao heuristicas visuais;
quando nao ha evidencia suficiente, ficam `other`/`unknown`. Caudas nao detectadas ficam `none`;
nao foi inventada uma classificacao de pensamento nem uma direcao de cauda.

## Progresso, cache e cancelamento

Cada pagina passa por render, deteccao, OCR, validacao e persistencia antes da seguinte.
O PDF libera seus recursos de pagina e os canvases sao zerados. O worker e reutilizado.
O ZIP acumula imagens comprimidas, nunca dezenas de bitmaps decodificados. O retorno final
em `Uint8Array` ainda exige RAM proporcional ao tamanho do pacote, nao e uma exportacao ilimitada para disco.

Estados: PREPARING, PROCESSING_PAGE, SAVING, COMPLETED e FAILED. AbortSignal cancela render/OCR;
somente um pacote finalizado pode entrar no cache de concluidos. Paginas ja validadas permitem
retomada sem repetir OCR. Mudanca no PDF, algoritmo ou configuracao de capas invalida a chave.
O leitor existente consulta os dados concluidos, inclusive para configuracoes alternativas de capa,
e nao repete o OCR antigo quando os encontra. Sem conversao, conserva o comportamento anterior.

Cancelamento real no Chromium: `FAILED: AbortError`, download desabilitado, nenhum registro
COMPLETED, nenhum erro nao tratado. O mesmo ensaio confirmou a rejeicao de `contentType: "book"`.

## Pacote real

Origem: primeiras quatro paginas do `capitulo01.pdf` real encontrado em
`/tmp/claude-1000/-home-delima-projeto-lumeo/833b0995-fc86-4e4e-913c-61df6b8403a2/scratchpad/real/`.
O PDF original tem 19 paginas; a prova nao pretende representar uma conversao de todas elas.
Foi usada a mesma API Web de producao do conversor, no Chromium, sem mocks de OCR ou render.

Artefato: `/tmp/lumeo-real.lima`, 4.198.047 bytes, 4 imagens de 1562 x 2400 pixels.

```text
manifest.json                 format: lima, version: 1, contentType: comic
pages/001.webp ... 004.webp    paginas completas
interaction/001.json ... 004.json
metadata/metadata.json
```

O pacote em disco foi desserializado e todos os 57 centros de regioes passaram no hit-test,
retornando o proprio ID e texto. Cada interaction tem o indice da pagina correspondente.

| Pagina | Regioes | Para revisao | Observacao |
| --- | ---: | ---: | --- |
| 1 | 0 | 0 | Capa, sem OCR |
| 2 | 21 | 21 | Texto editorial e creditos; limites nao verificados/ruido |
| 3 | 16 | 4 | 13 caixas narrativas visiveis e 3 candidatos de ruido |
| 4 | 20 | 20 | Dialogos; ha resultados incompletos e falsos positivos |

A pagina 3 foi comparada visualmente com os bounds. Exemplo real, coordenadas sem arredondamento:

```json
{
  "id": "p3-r1",
  "pageIndex": 2,
  "text": "Vamos falar de\nresponsabilidades.",
  "x": 0.07042253521126761,
  "y": 0.045,
  "width": 0.14596670934699102,
  "height": 0.026666666666666672,
  "type": "caption",
  "shape": "rectangle",
  "tailDirection": "none",
  "ocrConfidence": 0.89,
  "recognitionStatus": "recognized",
  "reviewReasons": []
}
```

`hitTest(2, { x: 0.1434058898847631, y: 0.058333333333333334 })` retorna exatamente `p3-r1`
e o texto acima. O indice da API e zero-based, portanto corresponde a pagina 3.
Outro exemplo: `p4-r2` reconheceu quatro linhas de uma fala em uma unica regiao,
com confidence 0.92; manteve a sinalizacao de revisao por limite nao verificado.

## Fitting, tema e performance

O fitting existente ja usa contain e uma geometria compartilhada. `presentationFit` explicita
as proporcoes, escala uniforme e um campo futuro `contentBounds`, que ainda nao altera a area visivel.
Nao ha esticamento nem crop. A geometria nao depende de comecar um gesto.

Testes com o proprio ComicTurnRenderer, pixels do canvas e screenshots em ambos os temas:

| Viewport | Pagina/slot | Modo |
| --- | --- | --- |
| 412 x 915 | 412 x 633 | Single |
| 834 x 1194 | 777 x 1194 | Single |
| 1194 x 834 | 543 x 834 | Single |
| 1440 x 900 | 531 x 816 por pagina | Spread |

As geometrias foram identicas antes e depois de chamar drawTurn. Fundos medidos:
claro RGB(235,231,222), dark RGB(20,20,18), usando as paletas existentes.
Esses sao ensaios Chromium com viewports mobile/tablet; nao medicao em aparelho Android fisico.

Ultima prova: 23.562 ms de conversao, 129 ms ao reutilizar o cache, 232 ticks de um timer de 100 ms.
Maior intervalo do timer: 292 ms. Heap JS observado: pico 37,6 MB e final 10,9 MB.
Esses valores nao incluem toda a memoria de WebAssembly, PDF.js, GPU ou processo do navegador.
Um canvas RGBA de 1562 x 2400 ocupa cerca de 15 MB; o buffer de analise e o worker acrescentam memoria.

## Verificacao e limites

- 74 testes focados de HQ: passaram.
- `npm run typecheck`: passou.
- `npm run build`: passou; avisos existentes de tamanho de chunks/imports PDF.js.
- `npm run test`: servidor 112/112; frontend/storage 793/794.
- Unica falha: `ReaderDisplay.test.ts`, regex preexistente sobre restauracao de brilho. Nao alterado.
- `git diff --check`: passou.

Artefatos locais: `/tmp/lumeo-comic-report.json` (todos os textos/bounds/confidences),
`/tmp/lumeo-comic-fitting.json`, `/tmp/lumeo-comic-debug-desktop.png`,
`/tmp/lumeo-comic-debug-mobile.png`, `/tmp/lumeo-comic-debug-tablet.png`,
`/tmp/lumeo-fitting-mobile-light.png`, `/tmp/lumeo-fitting-tablet-dark.png`,
`/tmp/lumeo-task2-tests.log` e `/tmp/lumeo-task2-build.log`.

Revalidar o pacote: `npx tsx scripts/validate-comic-lima.ts /tmp/lumeo-real.lima`.
Debug local: `http://127.0.0.1:5191/dev/comic-conversion.html`, disponivel no servidor Vite iniciado.
Bounds desligados por padrao; a entrada nao integra a interface final nem o build principal.

Limites: segmentacao de caixas coloridas/escuras, formas complexas e letras pequenas ainda pode
falhar. Ha falsos positivos e frases incompletas preservados para revisao. Nao se declara OCR
perfeito nem pronta a interacao final de baloes. A exportacao real esta implementada e a qualidade
encontrada na prova esta explicitada acima, sem depender apenas de testes sinteticos.

O motor de livros comuns, sua paginacao, selecao e page-turn nao foram alterados por esta tarefa.
A fisica, animacao, controlador e renderizador de page-turn da HQ nao foram alterados por esta tarefa.
Nao foram implementados expansao, 3D de baloes, cliques finais, avaliacoes ou e-mail.
