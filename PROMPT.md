# Regras permanentes de interface

Em mobile e tablet, a navegação principal deve usar menu hambúrguer com drawer lateral animado. Em desktop, deve usar navegação horizontal no Header. Os dois devem consumir a mesma fonte de rotas.

Menus laterais nunca devem aparecer/desaparecer instantaneamente; devem usar transição visual de entrada e saída.

O leitor deve priorizar conteúdo e foco. Controles devem ser discretos, consistentes com a identidade visual e nunca transformar o Reader em dashboard.

O leitor nunca deve usar viewer visual padrão do navegador ou PDF.js; PDF.js deve ser usado somente como engine.

Toda origem de importação deve convergir para o mesmo ImportManager, formulário de personalização e armazenamento IndexedDB. Arquivos importados nunca devem ser enviados ao backend.

A capa deve ser extraída automaticamente do próprio PDF ou EPUB e persistida localmente. Imagem manual serve apenas para trocar a capa; pesquisa web e thumbnails externas não devem ser usadas.

Todo livro deve preservar como capa frontal a capa real do próprio arquivo: primeira página no PDF e capa embutida no EPUB. O fluxo padrão não solicita upload manual. A capa original não pode ser substituída por imagem genérica quando sua extração for possível. No BookCard 3D, a aplicação gera somente a lombada, identificada por título e autor e com cores compatíveis com a capa quando possível.

A Biblioteca principal é representada como estantes físicas digitais.

Cada gênero corresponde a uma prateleira horizontal independente.

Os gêneros são navegados verticalmente.

Os livros são navegados horizontalmente.

BookCards não podem ser exibidos como cards 2D convencionais.

O estado padrão deve apresentar lombada e parte da capa usando perspectiva 3D.

Primeiro toque seleciona e traz o livro para frente.

Segundo toque abre a leitura.

Autor e gênero são conceitos distintos.

Autores podem gerar coleções/prateleiras próprias.

Classificação automática deve sugerir, não modificar silenciosamente a organização da biblioteca quando houver incerteza.

Livro frontal exibe somente a capa, sem lombada ou lateral. Lombada, páginas e espessura aparecem apenas quando o livro está realmente inclinado em 3D. A inclinação e a compactação aumentam conforme a quantidade de livros na prateleira.

No celular, o Reader substitui integralmente o conteúdo principal e ocupa toda a tela útil, com toolbar compacta e foco no conteúdo.

O Reader principal para PDF textual deve priorizar Reflow Mode.

No Reflow Mode, o fundo visual original da página PDF não deve ser utilizado.

O papel digital é criado pela aplicação.

PDFs escaneados devem ser detectados e tratados como fallback, com aviso ao usuário.

Page Turn 3D deve reagir progressivamente ao gesto e não ser apenas uma animação disparada depois do swipe.

No desktop, o Reader deve suportar modo livro aberto com duas páginas visíveis lado a lado, navegação por setas e interação de arrastar página.

A animação de folhear deve responder em tempo real ao Pointer Event.

Setas, teclado, touch e mouse devem reutilizar a mesma PageTurnEngine.

A virada não pode reiniciar quando o usuário solta o gesto; ela deve continuar da posição visual atual.

O Reader deve oferecer personalização visual simples para o usuário, sem expor termos técnicos desnecessários.

Alterações de fonte, papel e layout devem preservar a posição lógica de leitura.

Mobile utiliza uma página. Tablet e desktop podem oferecer uma ou duas páginas conforme espaço.

Grifos, notas e marcadores devem usar âncoras lógicas de conteúdo, nunca coordenadas absolutas de tela.

Mudança de fonte, papel ou layout não pode desconectar a marcação do trecho original.

Seleção de texto deve coexistir com PageTurn sem conflito.

Ferramentas de estudo externas devem operar somente sobre conteúdo explicitamente selecionado pelo usuário.

Nenhum recurso de significado, tradução ou pesquisa pode enviar o livro inteiro para serviços externos.

.lima é o formato interno oficial de leitura da aplicação.

PDF e EPUB são formatos de origem.

O Reader deve preferir LimaReaderEngine quando a conversão estiver disponível.

O conteúdo LIMA deve usar âncoras lógicas e nunca depender de coordenadas absolutas de tela.

O Reader deve utilizar a estrutura semântica do .lima para navegação.

Busca, sumário e mapa do livro devem trabalhar com blockId e chapterId, nunca com coordenadas visuais fixas.

Navegações temporárias não devem sobrescrever o progresso de leitura.

O Caderno é a visão consolidada de estudo de cada livro.

Toda navegação entre Caderno e Reader deve utilizar âncoras lógicas.

O Caderno deve refletir alterações de grifos, notas e marcadores sem depender de reload completo.

O Fichário do capítulo é conteúdo criado pelo usuário e deve permanecer separado do conteúdo-base do livro.

Toda referência a trechos do livro deve usar âncoras lógicas.

Resumo, tópicos, perguntas e dúvidas permanecem locais por padrão.

Uma vez importado, um livro deve permanecer disponível localmente entre reloads e reinicializações.

Google Drive, URL, PDF e EPUB são fontes de importação; o Reader não deve depender de baixar novamente o livro depois que ele estiver armazenado.

Em desktop, a aplicação pode usar uma pasta escolhida pelo usuário como biblioteca externa persistente.

Em mobile/PWA, a persistência primária deve utilizar armazenamento local da aplicação.

Livros importados são persistentes por padrão.

Depois que PDF/EPUB/Drive/URL for convertido e salvo localmente, a leitura não deve depender novamente da origem externa.

A aplicação deve restaurar automaticamente a biblioteca no startup.

Em desenvolvimento, a porta localhost deve permanecer fixa para manter o mesmo origin.

O desktop pode utilizar uma pasta LIMA escolhida pelo usuário como biblioteca externa adicional.

Mobile/PWA utiliza armazenamento persistente interno da aplicação.

Livro frontal mostra somente a capa.

Livro em perspectiva mostra capa e lateral.

A lateral nunca deve aparecer quando o livro estiver totalmente de frente.

Todo livro visual da biblioteca deve ser construído a partir de um esqueleto 3D próprio.

A capa pertence exclusivamente à face frontal.

A lombada é uma face independente derivada visualmente da capa.

Modo frontal nunca mostra lombada nem topo.

Modo inclinado mostra capa + lombada conforme a perspectiva.

A prateleira visual é independente do trilho rolável dos livros.

Somente os livros deslizam horizontalmente.

Livros do mesmo autor podem ser agrupados em subseções “Obras de {autor}”, sem substituir o gênero.

O texto da lombada deve ser uma linha tipográfica rotacionada como unidade, nunca letras empilhadas verticalmente.

Selecionar um livro deve produzir uma retirada parcial e progressiva da estante, preservando sua perspectiva diagonal.

Ao selecionar outro livro, o anterior deve retornar enquanto o novo avança, permitindo animações simultâneas.

O label do livro deve evitar repetir informação já explícita no contexto da prateleira.

Resumos e informações editoriais nunca devem ser inventados.

O estado FOCUSED nunca transforma um livro em vista frontal.

RESTING, FOCUSING, FOCUSED e RETURNING preservam perspectiva diagonal.

O drawer mobile/tablet deve possuir fundo próprio, overlay e animação de entrada/saída sem display:none durante a transição.

A decisão entre FRONT, ANGLED_SOFT e ANGLED deve usar a quantidade de livros da prateleira/grupo efetivamente renderizado.

Com 3 ou mais livros na mesma prateleira, o modo ANGLED é obrigatório.

Com 3 ou mais livros na mesma prateleira/grupo renderizado, todos os livros devem usar visual inclinado/diagonal com frente e lombada visíveis.

O primeiro clique em um livro deve puxá-lo visualmente para frente, preservando a diagonal.

O segundo clique no mesmo livro deve abrir o Reader.

Prateleiras com 3 ou mais livros devem manter cada Book3D em uma posição própria, próxima das demais, sem sobreposição, com aproximadamente 60% a 85% da capa perceptível.

O foco não pode alterar o espaço ocupado pelo livro na fileira; ao retornar, ele deve reassumir exatamente sua posição compacta original.

Book3D é o objeto visual padrão da biblioteca. A capa é apenas sua face frontal.

Com 3 ou mais livros, todos os itens devem renderizar como objetos 3D completos com frente, lombada e profundidade. A compactação não pode transformar a shelf em uma pilha de capas 2D.

O primeiro clique retira parcialmente o Book3D da estante em profundidade. O segundo clique abre o Reader.

O Book3D da estante deve seguir a referência física aprovada: capa dominante, lombada arredondada claramente visível, topo de páginas claro e perspectiva levemente vista de cima. Ao selecionar, o movimento deve priorizar profundidade, com escala mínima.

O visual oficial da biblioteca é o Book3D inspirado na referência aprovada: lombada à esquerda, capa frontal em leve perspectiva, topo/páginas visíveis e profundidade física.

O primeiro clique retira o livro para frente sem afetar os vizinhos. Ao selecionar outro livro, o anterior retorna pelo mesmo caminho geométrico em animação reversa.

Na biblioteca mobile, a composição oficial inclui cabeçalho premium com assinatura da marca, busca e navegação inferior fixa. A rotação deve expor claramente a lombada física posicionada à esquerda.

Na estante, devem existir somente livros 3D físicos, prateleira de madeira e suas sombras; capas não podem parecer cartões 2D soltos.

Cada Book3D inclinado possui face frontal, lombada independente, topo da capa, topo das páginas, profundidade traseira e sombra de contato própria.

Livros permanecem em posições independentes, sem sobreposição, com gap e padding lateral de 10 px no carrossel responsivo.

O carrossel horizontal usa scroll snap por proximidade. Arrastar não seleciona livro e, quando houver foco, iniciar o arraste devolve o livro à posição de repouso.

O foco preserva exatamente o ângulo de repouso, move somente o livro escolhido em profundidade e não desloca seus vizinhos. O retorno utiliza o caminho geométrico inverso.

Clicar no fundo vazio da estante remove o foco. O nome contextual do livro focado permanece centralizado na prateleira, independentemente da posição horizontal do volume.

Na biblioteca em estantes, qualquer quantidade de livros utiliza Book3D inclinado; volumes isolados ou em dupla não podem ser apresentados como capas frontais planas.

O ângulo visual da estante deve ser calibrado pela inspeção da geometria projetada, sempre preservado durante foco e retorno; na convenção CSS do cubo atual usa-se sinal positivo para expor fisicamente a lombada esquerda.

Book3D usa geometria única de paralelepípedo fino com frente, lombada, topo de capa, topo de páginas, profundidade direita, verso e sombra de contato independentes.

O foco move apenas o volume interno em translateZ positivo: 42 px no mobile, 64 px no tablet e 88 px no desktop. A raiz do card e os retângulos dos vizinhos permanecem imóveis.

A retirada do livro focado segue a diagonal da lombada: combina translateX negativo, translateZ positivo e translateY mínimo sem alterar rotateX ou rotateY. A sombra acompanha lateralmente e o retorno percorre exatamente o vetor inverso.

O espaçamento oficial entre livros independentes na fileira é 4 px, sem margem negativa ou sobreposição; o padding das pontas permanece 10 px.

A fileira física refinada usa gap de 4 px, inclinação de 38 graus para três ou mais volumes e profundidade/lombada desktop de 1,65 rem, mantendo posições independentes sem sobreposição.

Séries são detectadas por autor, título-base e marcadores Volume, Vol., V., Parte ou Tomo. Volumes relacionados são ordenados numericamente; livros sem série preservam a ordem natural da biblioteca.

Em prateleiras “Obras de Autor”, a lombada prioriza título e volume e pode omitir o autor já explícito no contexto. Em prateleiras comuns, mantém título, volume e autor.

A composição encaixada oficial permite sobreposição visual controlada: o livro seguinte cobre parte da frente do anterior, preservando cerca de 20% a 45% da capa, lombada legível e posições fixas. A fileira usa gap de 2 px e não sofre reflow durante foco.

Internacionalização completa do produto será consolidada no Prompt 11. Até lá, toda nova UI deve usar I18nManager e chaves de tradução.

Reader settings são abertas exclusivamente pela engrenagem.

Gestos TAP, SWIPE, LONG_PRESS e TEXT_SELECTION são independentes.

Grifos usam âncoras LIMA, nunca coordenadas de tela.

Todas as novas strings visíveis usam I18nManager.

Documentos escaneados usam fallback visual local.

O arquivo original nunca é modificado.

TextHighlight e RegionHighlight são tipos distintos.

OCR é opcional e não deve ser dependência obrigatória.

Filtros de scan são aplicados somente na renderização.

O Reader deve priorizar o conteúdo e ocultar chrome quando inativo.

A posição de leitura é semântica e deve sobreviver a repaginação.

Alterações de fonte/layout/orientação nunca retornam o usuário ao início.

Mobile usa página única por padrão.

Configurações continuam exclusivas da engrenagem.

A geometria encaixada usa inclinação de 46 graus para três ou mais volumes e lombada/profundidade desktop de 2 rem. O foco conserva o ângulo e usa trajetória diagonal de -12/-18/-24 px no eixo X, conforme viewport.

A madeira da estante é um objeto visual 3D com face superior, frontal, espessura e sombra inferior.

Cada Book3D possui sombra de contato independente no plano da madeira.

Ao ser selecionado, o livro mantém integralmente sua geometria e sai da shelf seguindo o próprio eixo de orientação.

A iluminação e a sombra respondem progressivamente ao foco e ao retorno.

Lumeo é local-first.

Livros do usuário não são enviados ao backend.

Atualizações nunca interrompem uma sessão de leitura sem consentimento.

Migrações de IndexedDB devem ser versionadas.

Limpeza automática nunca remove livros, grifos, notas ou progresso.

O arquivo original é sempre preservado.

Dados privados do Reader não entram em diagnóstico.

Segredos nunca ficam no frontend.

Conteúdo de livros e dados de estudo nunca entram em logs.

Backend é fonte de verdade da licença.

Frontend mantém apenas cache de licença para UX/offline.

Conteúdo EPUB/LIMA externo é tratado como não confiável.

ZIPs são validados contra traversal e expansão excessiva.

PASS automatizado não equivale a PASS produção.

O Book3D físico usa capa dura e miolo como camadas distintas. O topo das páginas é uma face creme com profundidade, recuo e linhas sutis de folhas; permanece visível em repouso e foco. A geometria ampliada aproxima os volumes do usuário sem alterar o fluxo da biblioteca.

A extração física do Book3D move X e Z simultaneamente: X sempre negativo, em direção à lombada esquerda, e Z positivo, em direção ao usuário. O stacking permanece normal no início e ganha prioridade somente depois que o volume começa a sair; sombra e retorno usam a mesma trajetória inversa.

Book3D permanece reto no prumo e quase frontal. A perspectiva superior vem da câmera da shelf, não de tombamento do livro. No repouso, o livro fica recuado em relação à borda frontal da madeira. Ao focar, ele avança além dessa borda mantendo sua geometria. A iluminação aumenta proporcionalmente ao avanço e a sombra permanece projetada na superfície da madeira.

O Book3D é um sólido físico fechado com frente, lombada, verso, topo rígido, bloco de páginas tridimensional, profundidade lateral, face inferior e sombra independente. O foco preserva o rotateY calibrado da estante e extrai o volume para a esquerda e para frente; a área clicável permanece restrita às faces visíveis.

A solicitação posterior de reproduzir a imagem de 19_03_49 substitui o ângulo quase frontal: a referência mostra lombadas predominantes e capas recuadas à direita. A calibração usa rotateY de 72 graus, preservado durante o foco, com rotateX e rotateZ zerados. As lombadas exibem palavras em linhas horizontais, sem empilhar letras. A extração preserva a composição dos cinco volumes e as capas frontais continuam sendo as originais dos arquivos.

Na revisão seguinte, o usuário solicitou explicitamente repetir a capa extraída do próprio arquivo também na lateral visível e aprofundar a madeira para trás. A lateral usa a mesma imagem local da frente; livros sem capa mantêm identificação textual. O miolo permanece creme entre as capas e a madeira oferece superfície de apoio visível sob os volumes.

A estante principal deve priorizar a leitura visual da referência de 19_03_49: cinco volumes visíveis no mobile, livros retos no prumo, lombadas predominantes, pequena faixa de frente, topo creme com linhas de páginas comprimidas, capa dura envolvendo o miolo, madeira profunda sob os livros e foco extraindo o volume para esquerda + frente sem alterar a rotação.

Após aprovação do formato do Book3D, ajustes posteriores na estante devem preservar largura, altura, rotateY, lombada, capa, PageBlock, quantidade visual de livros, carrossel e hitbox. A correção permitida é no apoio físico sobre a ShelfTopFace: livros RESTING cerca de 18 px atrás da borda frontal, livro FOCUSED cerca de 5–8 px além da borda, movimento lateral aprovado preservado, deslocamento vertical/frontal como deslizamento sobre a madeira, brilho gradual 0.92→1.07, sombra curta em repouso e sombra mais difusa acompanhando o foco. A ShelfFrontFace pode ser mais espessa e escura com acabamento de madeira laqueada, sem alterar a profundidade de fundo do tampo.
