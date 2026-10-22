import { bindCommercialActions, mountHeader, openModal } from "./shared.js";
import { loadCatalog, mountFaq, mountHeroCovers, mountShowcase } from "./catalogo.js";

mountHeader(document.querySelector("[data-sales-header]"));

const LIVROS_CHECKOUT_URL = "https://pay.hotmart.com/U108112778D?off=fxd7x748&checkoutMode=10";
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sales-cta]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  window.location.assign(LIVROS_CHECKOUT_URL);
}, true);

bindCommercialActions();
document.querySelector("[data-sales-year]").textContent = String(new Date().getFullYear());
mountFaq();

function mountStories() {
  const root = document.querySelector("[data-stories-carousel]");
  const track = root?.querySelector("[data-stories-track]");
  const previous = root?.querySelector("[data-stories-previous]");
  const next = root?.querySelector("[data-stories-next]");
  const indicatorRoot = root?.querySelector("[data-stories-indicators]");
  if (!root || !track || !previous || !next || !indicatorRoot) return;

  const cards = [...track.querySelectorAll(".sales-story-card")];
  const indicators = cards.map((card, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Ir ao depoimento ilustrativo ${index + 1}`);
    button.addEventListener("click", () => card.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }));
    indicatorRoot.append(button);
    return button;
  });

  const currentIndex = () => cards.reduce((best, card, index) =>
    Math.abs(card.offsetLeft - track.scrollLeft) < Math.abs(cards[best].offsetLeft - track.scrollLeft) ? index : best, 0);
  const sync = () => {
    const active = currentIndex();
    indicators.forEach((indicator, index) => indicator.setAttribute("aria-current", String(index === active)));
  };
  const move = (direction) => {
    const nextIndex = Math.max(0, Math.min(cards.length - 1, currentIndex() + direction));
    cards[nextIndex].scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  track.addEventListener("scroll", sync, { passive: true });
  track.querySelectorAll("[data-story-image]").forEach((button) => {
    button.addEventListener("click", () => openModal(`
      <article class="sales-modal__dialog sales-story-modal" role="dialog" aria-modal="true" aria-label="Print ilustrativo ampliado">
        <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
        <img src="${button.dataset.storyImage}" alt="${button.dataset.storyAlt}" />
      </article>`));
  });
  sync();
}

mountStories();

try {
  const catalog = await loadCatalog("livros");
  mountHeroCovers(catalog.items || []);
  mountShowcase(catalog);
} catch (error) {
  const showcase = document.querySelector("[data-sales-showcase]");
  if (showcase) showcase.textContent = "Não foi possível carregar as vitrines neste momento.";
  console.error("Lumeo sales catalog unavailable", error);
}
