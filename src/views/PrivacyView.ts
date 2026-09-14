import { BaseView } from "./BaseView";

export class PrivacyView extends BaseView {
  public render(): HTMLElement {
    const main = this.createElement("article", "privacy-page page-shell");
    const heading = this.createElement("header", "privacy-page__heading");
    heading.append(
      this.createElement("span", "eyebrow", "Lumeo"),
      this.createElement("h1", "page-title", "Política de Privacidade"),
      this.createElement("p", "privacy-page__updated", "Última atualização: setembro de 2026."),
      this.createElement("p", "page-subtitle", "O Lumeo respeita a privacidade dos usuários e busca tratar os dados pessoais de forma transparente e segura."),
    );
    main.append(heading);
    this.section(main, "1. Dados tratados", [
      "Para disponibilizar autenticação e funcionamento da conta, o Lumeo trata informações fornecidas pelo usuário ou pelo provedor de autenticação utilizado, como nome, endereço de e-mail e identificador da conta.",
      "Quando o usuário utiliza a opção “Entrar com Google”, o Lumeo recebe as informações necessárias ao processo de autenticação, conforme as permissões apresentadas pelo Google.",
    ]);
    this.section(main, "2. Autenticação e armazenamento", [
      "O Lumeo utiliza Supabase para autenticação e infraestrutura de dados e pode utilizar o Google como provedor de autenticação.",
      "Dados necessários ao funcionamento da conta são processados na infraestrutura desses serviços. Dados da biblioteca e de leitura também são armazenados localmente no dispositivo ou navegador usado para acessar o Lumeo.",
    ]);
    this.section(main, "3. Livros e arquivos do usuário", [
      "O Lumeo permite importar arquivos de leitura, como PDF e EPUB, do dispositivo e de serviços escolhidos pelo usuário.",
      "Os arquivos adicionados à biblioteca são armazenados localmente pelos mecanismos disponibilizados pela plataforma. No Android, downloads do catálogo são salvos no armazenamento privado do aplicativo. O Lumeo também disponibiliza conteúdo proveniente do catálogo da aplicação.",
    ]);
    this.section(main, "4. Dados de leitura", [
      "Progresso de leitura, preferências, marcadores, destaques e anotações podem ser armazenados localmente para permitir o funcionamento das funcionalidades do aplicativo.",
    ]);
    this.section(main, "5. Serviços de terceiros", [
      "O Lumeo utiliza serviços de terceiros necessários ao funcionamento da aplicação, incluindo Supabase, Google e Vercel para autenticação, banco de dados, catálogo, hospedagem e infraestrutura, conforme o recurso utilizado.",
      "Esses serviços possuem suas próprias políticas e práticas de privacidade.",
    ]);
    this.section(main, "6. Segurança", [
      "O Lumeo adota controles técnicos e limita o acesso a dados e credenciais de servidor de acordo com a finalidade de cada componente. Nenhum sistema, contudo, pode garantir segurança absoluta.",
    ]);
    this.section(main, "7. Compartilhamento", [
      "O Lumeo não vende dados pessoais dos usuários.",
      "Informações podem ser processadas pelos prestadores de infraestrutura necessários ao funcionamento do serviço ou quando exigido por obrigação legal.",
    ]);
    this.section(main, "8. Direitos do usuário", [
      "O usuário pode solicitar informações relacionadas aos seus dados e, quando aplicável, solicitar correção ou exclusão de informações associadas à sua conta pelo canal oficial de contato da aplicação.",
      "A remoção do aplicativo, dos dados do navegador ou do armazenamento local pode excluir dados mantidos somente no dispositivo.",
    ]);
    this.section(main, "9. Alterações", [
      "Esta Política de Privacidade poderá ser atualizada para refletir mudanças no aplicativo, nos serviços utilizados ou em requisitos legais. A data da revisão mais recente será indicada nesta página.",
    ]);
    this.section(main, "10. Contato", [
      "Para questões relacionadas à privacidade ou ao funcionamento do Lumeo, utilize o canal de contato oficial informado pela aplicação.",
    ]);
    return main;
  }

  private section(root: HTMLElement, title: string, paragraphs: readonly string[]): void {
    const section = this.createElement("section", "privacy-page__section");
    section.append(this.createElement("h2", "privacy-page__title", title), ...paragraphs.map((text) => this.createElement("p", "", text)));
    root.append(section);
  }
}
