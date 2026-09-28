import { ComicArchiveSource } from "../src/reader/comic/ComicArchiveSource";

const status = document.querySelector<HTMLElement>("#status")!;
const pages = document.querySelector<HTMLElement>("#pages")!;
const picker = document.querySelector<HTMLInputElement>("#file")!;
let source: ComicArchiveSource | null = null;

async function inspect(file: File): Promise<void> {
  await source?.close(); source = new ComicArchiveSource(); pages.replaceChildren();
  status.textContent = "Abrindo arquivo...";
  try {
    const count = await source.open(file);
    for (const page of [1, Math.min(2, count)]) {
      const canvas = await source.render(page, { width: 390, height: 640 });
      if (canvas) pages.append(canvas);
    }
    status.textContent = `${file.name}: ${count} páginas; capa e página seguinte desenhadas.`;
    status.dataset.result = "pass";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Falha ao abrir HQ.";
    status.dataset.result = "fail";
  }
}

picker.addEventListener("change", () => { if (picker.files?.[0]) void inspect(picker.files[0]); });
const fixture = new URL(location.href).searchParams.get("fixture");
if (fixture && /^\/archive-fixtures\/(001\.cbr|005\.cbz)$/.test(fixture)) {
  void fetch(fixture).then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await inspect(new File([await response.blob()], fixture.split("/").at(-1)!));
  }).catch(error => { status.dataset.result = "fail"; status.textContent = String(error); });
}
