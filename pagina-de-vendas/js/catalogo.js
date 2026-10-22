import { openSynopsis } from "./shared.js";

export async function loadCatalog(file = "livros") {
  const response = await fetch(`data/${file}.json`);
  if (!response.ok) throw new Error(`Não foi possível carregar ${file}.json`);
  return response.json();
}

function bookCard(item) {
  const card = document.createElement("article");
  card.className = "sales-book-card";
  card.innerHTML = `
    <button class="sales-book-card__cover" type="button" aria-label="Ver detalhes de ${item.titulo}">
      <img loading="lazy" src="${item.capa}" alt="Capa de ${item.titulo}" />
      <span>Toque 2x para ver a sinopse</span>
    </button>
    <h3>${item.titulo}</h3>
    <p>${item.autor || item.genero || "Disponível no Lumeo"}</p>`;
  const cover = card.querySelector("button");
  let lastTapAt = 0;
  let releaseTimer;
  const pauseRail = () => {
    const rail = card.closest(".sales-shelf__rail");
    if (rail) rail.style.animationPlayState = "paused";
  };
  const resumeRail = () => {
    window.clearTimeout(releaseTimer);
    releaseTimer = window.setTimeout(() => {
      const rail = card.closest(".sales-shelf__rail");
      if (rail) rail.style.removeProperty("animation-play-state");
    }, 120);
  };
  cover.addEventListener("pointerdown", pauseRail);
  cover.addEventListener("pointerup", resumeRail);
  cover.addEventListener("pointercancel", resumeRail);
  cover.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastTapAt <= 450) {
      lastTapAt = 0;
      // A sinopse recebe foco no modal; a vitrine permanece parada por trás dela.
      window.clearTimeout(releaseTimer);
      pauseRail();
      openSynopsis(item);
      return;
    }
    lastTapAt = now;
  });
  return card;
}

export function mountHeroCovers(items) {
  const root = document.querySelector("[data-sales-hero-covers]");
  if (!root) return;
  root.replaceChildren(...items.slice(0, 6).map((item, index) => {
    const image = document.createElement("img");
    image.src = item.capa;
    image.alt = "";
    image.loading = index > 2 ? "lazy" : "eager";
    return image;
  }));
}

export function mountShowcase(payload) {
  const shelves = [...document.querySelectorAll("[data-sales-shelf]")];
  const sections = (payload.sections || []).filter((section) => section.items?.length);
  if (!shelves.length) return;

  shelves.forEach((container, index) => {
    const section = sections[index % sections.length];
    if (!section) return;
    const title = section.titulo || "Livros para descobrir";
    container.innerHTML = `
      <div class="sales-shelf__track" aria-label="Capas de ${title}">
        <h2 class="sales-shelf__title">${title}</h2>
        <div class="sales-shelf__rail"></div>
      </div>`;
    const rail = container.querySelector(".sales-shelf__rail");
    // A segunda sequência é idêntica à primeira: o loop não salta ao reiniciar.
    rail.append(...[...section.items, ...section.items].map(bookCard));
  });
}

export function mountFaq() {
  const root = document.querySelector("[data-sales-faq]");
  if (!root) return;
  const faq = [
    ["Como acesso o Lumeo?", "Após a confirmação do pagamento, você recebe as orientações de acesso ao Lumeo."],
    ["Posso ler no celular?", "Sim. O Lumeo foi pensado para leitura em telas menores e também pode ser usado em telas maiores."],
    ["A leitura pode continuar offline?", "Livros já adicionados e armazenados localmente podem ficar disponíveis para leitura offline, conforme o dispositivo."],
    ["O catálogo inclui todos os livros exibidos?", "As vitrines apresentam exemplos do catálogo. A disponibilidade de cada título depende da fonte e do acesso configurado no aplicativo."],
  ];
  root.replaceChildren(...faq.map(([question, answer]) => {
    const detail = document.createElement("details");
    detail.innerHTML = `<summary>${question}</summary><p>${answer}</p>`;
    return detail;
  }));
}

// Mantido para que a página isolada de HQs da etapa anterior continue funcional.
export async function mountCatalog(file) {
  const carousel = document.querySelector("[data-sales-carousel]");
  const notice = document.querySelector("[data-sales-catalog-notice]");
  const more = document.querySelector("[data-sales-load-more]");
  if (!carousel || !notice || !more) return;
  try {
    const payload = await loadCatalog(file);
    const items = Array.isArray(payload.items) ? payload.items : [];
    let visible = 0;
    const draw = () => {
      const batch = items.slice(visible, visible + 12);
      visible += batch.length;
      carousel.append(...batch.map(bookCard));
      more.hidden = visible >= items.length;
      notice.textContent = items.length ? `${visible} de ${items.length} títulos disponíveis.` : "Nenhum título disponível.";
    };
    more.addEventListener("click", draw);
    draw();
  } catch {
    notice.textContent = "Catálogo comercial ainda não disponível.";
  }
}
