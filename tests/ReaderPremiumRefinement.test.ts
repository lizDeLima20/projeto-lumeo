import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ScanEnhancementPipeline } from "../src/reader/image/ScanEnhancementPipeline";
import { FirstReadGreeting } from "../src/reader/premium/FirstReadGreeting";
import type { StorageAdapter } from "../src/services/StorageService";

const css = () => readFileSync("src/styles/reader.css", "utf8");
const reader = () => readFileSync("src/views/ReaderView.ts", "utf8");

describe("abertura sem quadrado branco", () => {
  it("a tela de leitura só existe para livros em imagem; EPUB/Lima nunca a mostra", () => {
    const source = reader();
    assert.match(source, /this\.canvas\.hidden = true;/, "o placeholder branco fica escondido por padrão");
    assert.match(source, /this\.canvas\.hidden=false;this\.stage\.append\(this\.createElement\("p","reader-image-mode-notice"/, "só reaparece no ramo de imagem/PDF escaneado");
  });
  it("o palco de leitura usa o papel escolhido, não branco fixo, enquanto o livro carrega", () => {
    assert.match(css(), /\.reader-stage \{[^}]*background: var\(--reader-paper-lit,var\(--reader-bg\)\);/, "o fundo do carregamento acompanha o tema de papel");
  });
});

describe("papel, não tela acesa", () => {
  it("o fundo da página segue o tema em toda plataforma, com o mesmo mecanismo", () => {
    const rules = css();
    assert.match(rules, /--reader-paper-lit:var\(--reader-paper,#f6f1e7\)/, "a variável de fundo lê o tema escolhido, não um branco fixo");
    assert.equal(/reader-stage[^{}]*filter|\.reader-stage\s*\{[^}]*filter/s.test(rules), false, "nenhum filtro de brilho no palco - não é uma correção anterior a desfazer");
  });
  it("luz ambiente de cima para baixo na folha, não um brilho saindo dela", () => {
    const rules = css();
    assert.match(rules, /\.reflow-sheet:not\(\.reflow-sheet--cover\)::after\{position:absolute;inset:0;z-index:0;background:linear-gradient\(180deg,/, "sombra sutil no topo/rodapé da folha, gradiente vertical");
    assert.equal(/\.reflow-sheet[^{]*::after\{[^}]*radial-gradient/.test(rules), false, "nada radial centrado na página - isso pareceria uma lâmpada");
    assert.equal(rules.includes(".reflow-sheet--cover::after"), false, "a capa não recebe esse sombreamento de leitura diretamente");
    assert.match(rules, /\.reflow-sheet:not\(\.reflow-sheet--cover\)::after/, "o sombreamento exclui a capa explicitamente");
  });
  it("Papel, Claro, Sépia, Escuro cobrem branco puro, cinza-quente, sépia e escuro-suave, sem duplicar por plataforma", () => {
    const rules = css();
    assert.match(rules, /\.reader\[data-paper="paper"\]\{--reader-paper:#f6f1e7;--reader-ink:#2b2823;\}/);
    assert.match(rules, /\.reader\[data-paper="pure-white"\]\{--reader-paper:#fbfbf9;--reader-ink:#1e1e1c;\}/);
    assert.match(rules, /\.reader\[data-paper="sepia"\]\{--reader-paper:#f1e3c8;--reader-ink:#3b2e20;\}/);
    assert.match(rules, /\.reader\[data-paper="dark"\]\{--reader-paper:#1c1b19;--reader-ink:#d3cbbd;\}/);
    assert.equal(rules.includes('[data-native="android"][data-paper="paper"]'), false, "sem cópia dedicada ao Android");
  });
  it("o painel Web/Desktop e o painel Android compartilham a mesma lista de temas", () => {
    const panel = readFileSync("src/views/ReaderSettingsPanel.ts", "utf8");
    assert.match(panel, /private static readonly themes: ReadonlyArray<\[string, TranslationKey, string\]> = \[\["paper", "reader\.theme\.paper", "#f6f1e7"\], \["pure-white", "reader\.theme\.light", "#fbfbf9"\], \["sepia", "reader\.theme\.sepia", "#f1e3c8"\], \["dark", "reader\.theme\.dark", "#1c1b19"\]\];/);
    assert.match(panel, /body\.append\(this\.themeSegment\(\),this\.slider\(/, "o painel Web usa o mesmo seletor de temas do Android");
  });
});

describe("Desktop: livro mais largo", () => {
  it("a página usa mais da largura da tela do que antes, ainda limitada pela altura", () => {
    const rules = css();
    const match = rules.match(/--desktop-page-height:min\(calc\(100dvh - ([\d.]+)rem\),(\d+)vw\)/);
    assert.ok(match, "a variável de altura da página deve existir");
    assert.ok(Number(match![2]) >= 48, `esperava pelo menos 48vw, achei ${match![2]}vw`);
  });
});

describe("presets de imagem e perfil visual", () => {
  const pipeline = new ScanEnhancementPipeline();
  const settings = (preset: "original" | "scannedText" | "oldDocument" | "manga", profile: "normal" | "high-contrast" | "soft" = "normal") =>
    ({ preset, profile, brightness: 100, contrast: 100, sharpness: 0, grayscale: false, invert: false });

  it("Original preserva ao máximo: nenhum ajuste", () => {
    assert.equal(pipeline.filter(settings("original")), "sepia(0%) brightness(100%) contrast(100%) saturate(100%) grayscale(0) invert(0)");
  });
  it("Texto escaneado melhora legibilidade: mais brilho, mais contraste, sem cor", () => {
    const value = pipeline.filter(settings("scannedText"));
    assert.match(value, /brightness\(114%\)/); assert.match(value, /contrast\(134%\)/); assert.match(value, /grayscale\(1\)/); assert.match(value, /sepia\(0%\)/);
  });
  it("Documento antigo tem uma pátina sépia real, não apenas um pouco mais escuro", () => {
    const value = pipeline.filter(settings("oldDocument"));
    assert.match(value, /sepia\(38%\)/); assert.match(value, /grayscale\(0\)/);
    assert.notEqual(value, pipeline.filter(settings("original")), "precisa ser visivelmente diferente do original");
  });
  it("Mangá é contraste alto em preto e branco limpo", () => {
    const value = pipeline.filter(settings("manga"));
    assert.match(value, /contrast\(146%\)/); assert.match(value, /grayscale\(1\)/); assert.match(value, /sepia\(0%\)/);
  });
  it("cada preset produz um resultado diferente dos outros três", () => {
    const presets = ["original", "scannedText", "oldDocument", "manga"] as const;
    const results = presets.map((preset) => pipeline.filter(settings(preset)));
    assert.equal(new Set(results).size, presets.length, "presets não podem colapsar no mesmo filtro");
  });
  it("Normal, Contraste alto e Suave deslocam o contraste em direções opostas, coexistindo com o preset", () => {
    const normal = pipeline.filter(settings("scannedText", "normal"));
    const high = pipeline.filter(settings("scannedText", "high-contrast"));
    const soft = pipeline.filter(settings("scannedText", "soft"));
    const contrastOf = (value: string) => Number(value.match(/contrast\((\d+)%\)/)![1]);
    assert.ok(contrastOf(high) > contrastOf(normal));
    assert.ok(contrastOf(soft) < contrastOf(normal));
    assert.match(high, /grayscale\(1\)/, "o perfil não anula o preset");
  });
  it("brightness/contrast ficam dentro de limites seguros mesmo somando preset e perfil", () => {
    const value = pipeline.filter({ preset: "manga", profile: "high-contrast", brightness: 100, contrast: 100, sharpness: 0, grayscale: false, invert: false });
    const brightness = Number(value.match(/brightness\((\d+)%\)/)![1]), contrast = Number(value.match(/contrast\((\d+)%\)/)![1]);
    assert.ok(brightness <= 180 && brightness >= 40); assert.ok(contrast <= 220 && contrast >= 40);
  });
});

describe("primeira leitura", () => {
  const memory = (): StorageAdapter & { values: Map<string, unknown> } => {
    const values = new Map<string, unknown>();
    return { values, load: async (key) => (values.get(key) as never) ?? null, save: async (key, value) => { values.set(key, value); }, remove: async (key) => { values.delete(key); } };
  };
  it("mostra só na primeira abertura de um livro em 0%, nunca de novo", async () => {
    const storage = memory(), greeting = new FirstReadGreeting(storage);
    assert.equal(await greeting.shouldGreet("book-1", false), true);
    await greeting.markGreeted("book-1");
    assert.equal(await greeting.shouldGreet("book-1", false), false, "não repete depois de marcado");
    assert.equal(await greeting.shouldGreet("book-2", false), true, "outro livro ainda não visto continua elegível");
  });
  it("nunca aparece se a leitura já começou (progresso > 0)", async () => {
    const greeting = new FirstReadGreeting(memory());
    assert.equal(await greeting.shouldGreet("book-1", true), false);
  });
  it("no Desktop (spread) a saudação transitória não compete com a saudação permanente da capa", () => {
    const source = reader();
    assert.match(source, /private async offerFirstReadGreeting\(hasStartedReading:boolean\):Promise<void>\{\s*if\(this\.wantsSpread\(\)\|\|!this\.element\)return;/);
  });
});

describe("deslizar horizontal e vertical", () => {
  it("cada folha já sabe sua posição relativa (before/current/after) assim que é montada", () => {
    assert.match(reader(), /const relation=page\.index\+1<current\?"before":page\.index\+1===current\?"current":"after";/);
  });
  it("o modo Folhear continua intacto: PageTurnController só entra quando animation==\"page-turn\"", () => {
    const source = reader();
    assert.match(source, /if\(active&&animation==="page-turn"\)\{this\.turnController=new PageTurnController/);
    assert.match(source, /else if\(active&&animation==="slide"\)\{this\.turnController=new PageSlideController/);
    assert.match(source, /else if\(active&&animation==="carousel"\)\{this\.turnController=new PageVerticalController/);
  });
  it("Deslizar horizontal: sem curva, drag em translateX puro, com resistência nas pontas", () => {
    const source = readFileSync("src/reader/reflow/PageSlideController.ts", "utf8");
    assert.match(source, /PageGestureIntent\.startsTurn\(event\)/, "mesma regra: toque vira em qualquer lugar, mouse em texto seleciona");
    assert.match(source, /resisted = \(dx > 0 && !before\) \|\| \(dx < 0 && !after\) \? dx \* \.25 : dx/, "resiste nas pontas do livro em vez de abrir um vão");
    assert.equal(source.includes("rotateY"), false, "sem curvatura de folha nesse modo");
  });
  it("Deslizar horizontal: cada sheet aparece de verdade e recebe transform via CSS/JS combinados", () => {
    const rules = css();
    assert.match(rules, /\.reader\[data-animation="slide"\] \.reflow-sheet\{display:block!important;touch-action:pan-y pinch-zoom;user-select:none\}/);
    assert.match(rules, /\.reader\[data-animation="slide"\] \.reflow-sheet\.page-slide-settling\{transition:transform \.24s/);
  });
  it("Deslizar vertical: cada página some sozinha, sem virar rolagem livre do documento", () => {
    const rules = css();
    assert.match(rules, /\.reader\[data-animation="carousel"\] \.reflow-pages\{display:block;overflow-y:auto;overflow-x:hidden;scroll-snap-type:y mandatory;overscroll-behavior-y:contain\}/);
    assert.match(rules, /scroll-snap-align:start;scroll-snap-stop:always/, "scroll-snap-stop:always impede pular mais de uma página por vez");
    const source = readFileSync("src/reader/reflow/PageVerticalController.ts", "utf8");
    assert.match(source, /if \(!landed \|\| landed\.classList\.contains\("reflow-sheet--current"\)\) return;/);
  });
  it("a coluna vertical não pode ser display:grid: altura em % de uma folha não enche a linha ali, e nada rola", () => {
    // Regressão real, achada só num navegador de verdade: dentro de .reflow-pages
    // (display:grid do modo padrão), height:100% em cada folha vira o tamanho do próprio
    // conteúdo (linhas auto), as três folhas cabem espremidas numa fração da altura e
    // scrollHeight===clientHeight - nada rolava e a virada nunca disparava.
    const rules = css();
    const carouselHost = rules.match(/\.reader\[data-animation="carousel"\] \.reflow-pages\{([^}]*)\}/)?.[1] ?? "";
    assert.match(carouselHost, /display:block/, "sem isso, height:100% na folha não resolve dentro do grid da .reflow-pages");
  });
  it("teclado e o botão de virar página continuam funcionando em qualquer modo (turn())", () => {
    for (const file of ["src/reader/reflow/PageSlideController.ts", "src/reader/reflow/PageVerticalController.ts"]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /public turn\(direction: 1 \| -1\): Promise<boolean>/);
    }
  });
});
