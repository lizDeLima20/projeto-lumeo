import { CatalogBook } from "../models/CatalogBook";

// Somente conteúdos com direito de redistribuição poderão fazer parte do catálogo distribuído com o produto.
export class CatalogService {
  public getPreview(): readonly CatalogBook[] {
    return [
      new CatalogBook({ id: "catalog-1", title: "A Cartomante", author: "Machado de Assis", genre: "Ficção",
        coverUrl: "", fileUrl: "", format: "epub", description: "Obra em domínio público.", licenseType: "Domínio público", source: "Biblioteca pública" }),
      new CatalogBook({ id: "catalog-2", title: "O Alienista", author: "Machado de Assis", genre: "Ficção",
        coverUrl: "", fileUrl: "", format: "epub", description: "Obra em domínio público.", licenseType: "Domínio público", source: "Biblioteca pública" }),
    ];
  }
}
