import { bindCommercialActions, mountHeader, openModal } from "./shared.js";

mountHeader(document.querySelector("[data-sales-header]"));

const HQS_CHECKOUT_URL = "https://pay.hotmart.com/U108112778D?off=okhw2htf&checkoutMode=10";
document.querySelectorAll("[data-sales-cta]").forEach((button) => {
  button.dataset.salesBound = "true";
  button.addEventListener("click", () => window.location.assign(HQS_CHECKOUT_URL));
});

bindCommercialActions();
document.querySelector("[data-sales-year]").textContent = String(new Date().getFullYear());

const video = document.querySelector("[data-hqs-hero-video]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const syncMotion = () => {
  if (!video) return;
  if (reducedMotion.matches) video.pause();
  else video.play().catch(() => {});
};
reducedMotion.addEventListener("change", syncMotion);
syncMotion();

function mountStories() {
  const root = document.querySelector("[data-hqs-stories]");
  const track = root?.querySelector("[data-hqs-stories-track]");
  const indicatorRoot = root?.querySelector("[data-hqs-stories-indicators]");
  if (!root || !track || !indicatorRoot) return;

  const cards = [...track.querySelectorAll(".hqs-story")];
  const indicators = cards.map((card, index) => {
    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.setAttribute("aria-label", `Ir ao depoimento ilustrativo ${index + 1}`);
    indicator.addEventListener("click", () => card.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }));
    indicatorRoot.append(indicator);
    return indicator;
  });
  const currentIndex = () => cards.reduce((best, card, index) =>
    Math.abs(card.offsetLeft - track.scrollLeft) < Math.abs(cards[best].offsetLeft - track.scrollLeft) ? index : best, 0);
  const sync = () => {
    const active = currentIndex();
    indicators.forEach((indicator, index) => indicator.setAttribute("aria-current", String(index === active)));
  };
  const move = (direction) => {
    const target = Math.max(0, Math.min(cards.length - 1, currentIndex() + direction));
    cards[target].scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };
  root.querySelector("[data-hqs-stories-previous]")?.addEventListener("click", () => move(-1));
  root.querySelector("[data-hqs-stories-next]")?.addEventListener("click", () => move(1));
  track.addEventListener("scroll", sync, { passive: true });
  track.querySelectorAll("[data-hqs-story-image]").forEach((button) => {
    button.addEventListener("click", () => openModal(`
      <article class="sales-modal__dialog sales-story-modal" role="dialog" aria-modal="true" aria-label="Print ilustrativo ampliado">
        <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
        <img src="${button.dataset.hqsStoryImage}" alt="${button.dataset.hqsStoryAlt}" />
      </article>`));
  });
  sync();
}

mountStories();

document.querySelectorAll("[data-reader-experience-image]").forEach((button) => {
  button.addEventListener("click", () => openModal(`
    <article class="sales-modal__dialog sales-story-modal" role="dialog" aria-modal="true" aria-label="Reconstituição ilustrativa ampliada">
      <button class="sales-modal__close" type="button" data-sales-close aria-label="Fechar">×</button>
      <img src="${button.dataset.readerExperienceImage}" alt="${button.dataset.readerExperienceAlt}" />
    </article>`));
});
