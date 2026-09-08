# PROMPT J — verificação do Book3D

Resultado visual: **FAIL**. O novo sólido corrige a ausência de profundidade, mas ainda não reproduz de maneira convincente todas as proporções e o acabamento fotográfico da referência. Em particular, a frente inteira revelada no foco fica mais larga que a do livro selecionado na imagem-alvo.

## Geometria implementada

| Medida | Mobile | Tablet | Desktop |
| --- | ---: | ---: | ---: |
| Frente | 168 × 264 px | 192 × 288 px | 224 × 336 px |
| Lombada / profundidade | 72 px | 76 px | 80 px |
| Capa rígida | 3 px | 4 px | 4 px |
| Profundidade das páginas | 66 px | 68 px | 72 px |
| Recuo do miolo | 3 px | 3 px | 3 px |
| Rotação X / Y / Z | 0° / 3° / 0° | 0° / 3° / 0° | 0° / 3° / 0° |
| Foco X máximo / Z | −110 / 112 px | −145 / 150 px | −190 / 200 px |

A extração lateral é limitada perto da extremidade esquerda do viewport. A translação Y compensa a câmera elevada para manter a base na superfície. Não existe rotação vertical nem escala artificial durante o foco. Duração: 800 ms; easing: cubic-bezier(.20,.72,.18,1).

Frente em z=0; verso em z=−depth; lombada e lateral perpendiculares à frente; topo das páginas perpendicular à altura. O PageBlock contém PageTopFace, PageSideFace e PageFrontInset. Os três lábios da capa e a face inferior fecham as bordas. O topo usa #f2ead8, #e8dec7 e #d8cbb1. A capa original usa object-fit:contain; sua proporção não é alterada.

Filtros foram retirados do ancestral preserve-3d e aplicados somente às faces. A câmera local deixa o topo visível sem rotateX no livro. A sombra é irmã do volume e tem transição própria, sincronizada com a extração.

## Inspeção

Chrome com Emulation.setDeviceMetricsOverride: 412 × 915, deviceScaleFactor=1. Estante de validação isolada usando os componentes reais BookShelf, Book3D, controlador e animador; não foi usada a sessão autenticada do usuário. Capas extraídas das primeiras páginas de cinco PDFs locais: Quem Pensa Enriquece, A Chave para a Prosperidade, A Ciência do Sucesso, Os Segredos que Vão Mudar Sua Vida e As 16 Leis do Sucesso. Nenhuma capa foi pesquisada ou inventada.

- [Repouso](rest-final.png)
- [400 ms da extração](mid-final.png)
- [A Ciência do Sucesso em foco](focus-final.png)
- [A Chave para a Prosperidade em foco](chave-focus.png)
- [As 16 Leis do Sucesso em foco](leis-focus.png)

O topo projetado mede aproximadamente 31 px de altura no repouso. As faces se mantêm conectadas no foco. Cinco livros participam da composição, com recorte normal na extremidade.

Testes no navegador usaram elementFromPoint para encontrar faces efetivamente visíveis e Input.dispatchMouseEvent para clicar. Verificações aprovadas: primeiro clique foca; segundo clique aciona o callback de abertura; vizinho recebe foco; clique na madeira devolve o volume; posições dos slots não mudam; matriz local do topo permanece idêntica. O conteúdo do Reader não foi testado nessa página isolada.

Suíte: 314 testes da aplicação + 8 do servidor. Typecheck strict, build do frontend e build do servidor aprovados. A aprovação funcional não altera o resultado visual FAIL.

ShelfBoard e seus estilos, header, footer, Reader, busca, importação, persistência e agrupamentos não foram alterados. A página temporária e cópias de capas usadas para validação foram removidas após as capturas.

## Arquivos alterados

- src/components/Book3D.ts
- src/components/Book3DFaces.ts
- src/components/Book3DFactory.ts
- src/components/Book3DGeometry.ts
- src/components/BookFocusAnimator.ts
- src/components/BookInteractionRegion.ts
- src/styles/book-physical.css (novo)
- src/main.ts (importação do CSS do Book3D)
- tests/LibraryShelf.test.ts
- docs/validation/book3d-j/ (relatório e capturas)
