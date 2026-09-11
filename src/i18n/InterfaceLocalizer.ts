import type { TranslationKey } from "./I18nManager";

/**
 * Compatibility bridge for legacy DOM views. It is deliberately a static,
 * reviewed lookup table—not machine translation—and only replaces known UI
 * copy. Book text is never a key and therefore is left untouched.
 */
export const LEGACY_INTERFACE_COPY = {
  "Leia · Evolua · Transforme": "ui.brand.tagline", "Ir para o início": "ui.navigate.home", "Navegação principal": "ui.navigation.main", "Navegação mobile": "ui.navigation.mobile", "Navegação inferior": "ui.navigation.bottom", "Fechar menu": "ui.navigation.closeMenu", "Menu principal": "ui.navigation.menu", "Biblioteca": "ui.navigation.library", "Início": "ui.navigation.home", "Adicionar": "ui.navigation.add", "Ajustes": "ui.navigation.settings", "Sair": "ui.navigation.logout",
  "Boa leitura": "ui.greeting.goodReading", "Sua biblioteca espera": "ui.auth.waiting", "Comece agora": "ui.auth.startNow", "Entrar": "ui.auth.login", "Criar conta": "ui.auth.register", "E-mail": "ui.auth.email", "Senha": "ui.auth.password", "Confirmar senha": "ui.auth.confirmPassword", "Já tenho uma conta": "ui.auth.haveAccount", "Opcional no modo local": "ui.auth.localOptional", "Não foi possível entrar.": "ui.auth.loginFailed", "Não foi possível criar a conta.": "ui.auth.registerFailed", "As senhas não coincidem.": "ui.auth.passwordMismatch", "Use pelo menos 8 caracteres.": "ui.auth.passwordMinimum", "Confira seu e-mail para confirmar a conta.": "ui.auth.confirmEmail",
  "Sua próxima história está aqui.": "ui.home.title", "Abrir minha biblioteca": "ui.home.openLibrary", "Minha biblioteca": "ui.home.myLibrary", "Toque no livro para abrir": "ui.home.openHint", "+ Adicionar livro": "ui.home.addBook",
  "Minha Biblioteca": "ui.library.title", "Grandes ideias, uma vida extraordinária.": "ui.library.subtitle", "Buscar livros": "ui.library.search", "Buscar livros…": "ui.library.searchPlaceholder", "Sua biblioteca ainda não tem gêneros.": "ui.library.noGenres", "Adicione um livro para montar sua primeira prateleira.": "ui.library.addFirst", "← Voltar à biblioteca": "ui.library.back", "Gênero não encontrado": "ui.library.notFoundGenre", "Nenhum livro neste gênero ainda.": "ui.library.emptyGenre",
  "Livro não encontrado": "ui.book.notFound", "Sem gênero": "ui.book.noGenre", "Autor desconhecido": "ui.book.unknownAuthor", "Ler": "ui.book.read", "Formato": "ui.book.format", "Tamanho": "ui.book.size", "Status": "ui.book.status", "Não iniciado": "ui.book.unread", "Lendo": "ui.book.reading", "Concluído": "ui.book.finished", "Localizar arquivo": "ui.book.locateFile", "Arquivo local não encontrado.": "ui.book.fileMissing", "O arquivo local não pôde ser validado.": "ui.book.fileInvalid", "Editar livro": "ui.edit.title", "Título": "ui.edit.bookTitle", "Autor": "ui.edit.author", "Gênero": "ui.edit.genre", "Novo gênero": "ui.edit.newGenre", "+ Criar gênero": "ui.edit.createGenre", "Trocar capa": "ui.edit.changeCover", "Salvar alterações": "ui.edit.saveChanges", "Não foi possível salvar.": "ui.edit.saveFailed",
  "Seu espaço, do seu jeito": "ui.onboarding.customize", "Vamos preparar seu ambiente de leitura?": "ui.onboarding.prepare", "Como quer organizar seus livros?": "ui.onboarding.organize", "Você poderá alterar e criar novos gêneros depois.": "ui.onboarding.organizeHelp", "Quero todos os gêneros": "ui.onboarding.allGenres", "Começar com a seleção completa": "ui.onboarding.allGenresHelp", "Escolher meus gêneros": "ui.onboarding.chooseGenres", "Marcar apenas os que combinam comigo": "ui.onboarding.chooseGenresHelp", "Criar meus próprios": "ui.onboarding.customGenres", "Começar com categorias personalizadas": "ui.onboarding.customGenresHelp", "Selecionar gêneros": "ui.onboarding.selectGenres", "Sua seleção": "ui.onboarding.yourSelection", "Nenhum gênero selecionado ainda": "ui.onboarding.noGenres", "Gêneros personalizados": "ui.onboarding.customGenreLabel", "Digite um nome e ele aparecerá na sua seleção.": "ui.onboarding.customGenreHelp", "Ex.: Poesia brasileira": "ui.onboarding.customGenrePlaceholder", "Escolha a aparência": "ui.onboarding.appearance", "Preparar minha biblioteca": "ui.onboarding.finish", "Escolha pelo menos um gênero para continuar.": "ui.onboarding.chooseOne",
  "Voltar": "ui.common.back", "Cancelar": "ui.common.cancel", "Fechar": "ui.common.close", "Salvar": "ui.common.save", "Excluir": "ui.common.delete", "Editar": "ui.common.edit", "Remover": "ui.common.remove", "Abrir": "ui.common.open", "Tentar novamente": "ui.common.retry", "Pesquisar": "ui.common.search", "Carregando…": "ui.common.loading", "Preparando…": "ui.common.preparing", "Opcional": "ui.common.optional", "Confirmar": "ui.common.confirm",
  "Adicionar livro": "ui.import.title", "Selecionar arquivo": "ui.import.selectFile", "Importando…": "ui.import.importing", "Validando arquivo…": "ui.import.validating", "Importação concluída.": "ui.import.complete", "Arquivo inválido.": "ui.import.invalidFile", "Escolha um PDF ou EPUB": "ui.import.pdfEpub",
  "Configurações": "ui.settings.title", "Preferências": "ui.settings.preferences", "Aparência": "ui.settings.appearance", "Escolha como o Lumeo deve aparecer neste dispositivo.": "ui.settings.appearanceHelp", "Tema claro": "ui.settings.lightTheme", "Tema escuro": "ui.settings.darkTheme", "Escolher pasta da biblioteca": "ui.settings.chooseFolder", "Autorizar pasta": "ui.settings.authorizeFolder", "Pasta da biblioteca autorizada.": "ui.settings.folderAuthorized", "A seleção da pasta foi cancelada.": "ui.settings.folderCancelled", "A biblioteca está nesta pasta. Autorize o acesso para continuar.": "ui.settings.folderPermission",
  "Instalar o Lumeo": "ui.pwa.installLumeo", "Instalar app": "ui.pwa.installApp", "O Lumeo já está instalado neste dispositivo.": "ui.pwa.installed", "Tenha o Lumeo na tela inicial, abrindo em tela cheia e funcionando sem internet.": "ui.pwa.installDescription", "No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.": "ui.pwa.safariInstall", "Abra o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.": "ui.pwa.browserInstall", "Instalando o Lumeo…": "ui.pwa.installing",
  "Disponível no modo de leitura adaptável.": "ui.reader.adaptiveOnly", "Disponível em telas a partir de 768 px": "ui.reader.spreadAvailable", "Abrir fichário": "ui.reader.openSheet", "Não foi possível abrir o PDF com essa senha.": "ui.reader.pdfPassword", "O PDF parece inválido ou corrompido. Tente importá-lo novamente.": "ui.reader.pdfInvalid",
  "Caderno": "ui.study.notebook", "Fechar Caderno": "ui.study.closeNotebook", "Seu estudo neste livro": "ui.study.yourStudy", "Exibir": "ui.study.show", "Tudo": "ui.study.all", "Grifos": "ui.study.highlights", "Notas": "ui.study.notes", "Marcadores": "ui.study.bookmarks", "Cor": "ui.study.color", "Todas as cores": "ui.study.allColors", "Ordenar": "ui.study.sort", "Ordem do livro": "ui.study.bookOrder", "Mais recentes": "ui.study.newest", "Mais antigos": "ui.study.oldest", "Buscar nas marcações": "ui.study.searchMarks", "Agrupar por capítulo": "ui.study.groupChapter", "Revisar": "ui.study.review", "Iniciar revisão": "ui.study.startReview", "Nenhuma marcação encontrada.": "ui.study.noMarks", "Editar nota": "ui.study.editNote", "Remover entrada": "ui.study.removeEntry", "Anterior": "ui.study.previous", "Próxima": "ui.study.next", "Sair da revisão": "ui.study.exit", "Abrir no livro": "ui.study.openInBook",
  "Fichário do capítulo": "ui.chapter.sheet", "Fechar fichário": "ui.chapter.closeSheet", "Buscar neste fichário": "ui.chapter.search", "Salvando…": "ui.chapter.saving", "Salvo": "ui.chapter.saved", "Meu resumo": "ui.chapter.summary", "Escreva com suas palavras…": "ui.chapter.writeWords", "Tópicos principais": "ui.chapter.topics", "Novo tópico": "ui.chapter.newTopic", "Perguntas": "ui.chapter.questions", "Nova pergunta": "ui.chapter.newQuestion", "Resposta opcional": "ui.chapter.optionalAnswer", "Dúvidas": "ui.chapter.doubts", "Registrar dúvida": "ui.chapter.registerDoubt", "Observação opcional": "ui.chapter.optionalObservation", "Marcações deste capítulo": "ui.chapter.marks", "Nenhuma marcação neste capítulo.": "ui.chapter.noMarks", "Revisar capítulo": "ui.chapter.review", "Nenhuma pergunta criada.": "ui.chapter.noQuestions", "Sem resposta registrada.": "ui.chapter.noAnswer", "Ver resposta": "ui.chapter.seeAnswer", "Abrir trecho": "ui.chapter.openExcerpt", "Subir": "ui.chapter.moveUp", "Descer": "ui.chapter.moveDown",
} as const satisfies Readonly<Record<string, TranslationKey>>;

export type InterfaceTranslator = (key: TranslationKey, parameters?: Readonly<Record<string, string | number>>) => string;

export function localizeLegacyInterface(root: HTMLElement, translate: InterfaceTranslator): void {
  const translateValue = (value: string): string => {
    const key = (LEGACY_INTERFACE_COPY as Readonly<Record<string, TranslationKey>>)[value];
    if (key) return translate(key);
    const greeting = /^Olá, (.+)!$/.exec(value);
    if (greeting) return translate("ui.greeting.hello", { name: greeting[1]! });
    const saved = /^(\d+) (livro guardado|livros guardados) no seu ambiente de leitura\.$/.exec(value);
    if (saved) return `${translate("ui.home.booksSaved", { count: saved[1]! }).split("|")[Number(saved[1]) === 1 ? 0 : 1] ?? ""} ${translate("ui.home.booksSavedSuffix")}`;
    const collection = /^(\d+) (livro|livros) nesta coleção\.$/.exec(value);
    if (collection) return translate("ui.library.collectionBooks", { count: collection[1]! }).split("|")[Number(collection[1]) === 1 ? 0 : 1] ?? "";
    const cover = /^Capa de (.+)$/.exec(value);
    if (cover) return translate("ui.reader.coverOf", { title: cover[1]! });
    const removal = /^Remover (.+)$/.exec(value);
    if (removal) return translate("ui.onboarding.removeGenre", { name: removal[1]! });
    return value;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = []; let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  nodes.forEach(text => {
    const source = text.data, leading = source.match(/^\s*/)?.[0] ?? "", trailing = source.match(/\s*$/)?.[0] ?? "";
    const translated = translateValue(source.trim()); if (translated !== source.trim()) text.data = `${leading}${translated}${trailing}`;
  });
  root.querySelectorAll<HTMLElement>("[aria-label],[aria-description],[placeholder],[title]").forEach(element => {
    (["aria-label", "aria-description", "placeholder", "title"] as const).forEach(attribute => {
      const value = element.getAttribute(attribute); if (!value) return;
      const translated = translateValue(value); if (translated !== value) element.setAttribute(attribute, translated);
    });
  });
}
