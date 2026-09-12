# Entrar e criar conta com o Google

O botão do Google aparece em **Entrar**, **Criar conta** e na tela de **troca de aparelho**.
O mesmo botão cria a conta na primeira vez e entra nas seguintes.

## Como funciona

1. O navegador carrega o Google Identity Services e mostra o botão oficial (popup, não redirecionamento, para funcionar dentro do app instalado).
2. O app gera um nonce aleatório e entrega ao Google só o SHA-256 dele.
3. O Google devolve um ID token, que o app envia com o nonce original para `POST /api/auth/google`.
4. O servidor chama `signInWithIdToken` do Supabase, que valida o token e o nonce e devolve a sessão.
5. A sessão é a mesma do login por senha: renovação, vínculo de aparelho e licença não mudam.

Sem Client ID configurado, o botão continua visível e avisa que o login com Google ainda não está configurado.

## Configuração (uma vez)

### 1. Google Cloud Console

Em *APIs e serviços → Credenciais*, use o cliente OAuth do tipo **Aplicativo da Web** (o mesmo do Google Drive serve).

Em **Origens JavaScript autorizadas**, adicione:

- `https://lumeo-livros.vercel.app`
- `http://localhost:5173`

Não é preciso URI de redirecionamento: o fluxo é por popup.

### 2. Supabase

Em *Authentication → Sign In / Providers → Google*:

- ative o provedor;
- em **Client IDs** (IDs de cliente autorizados), cole o Client ID do passo 1;
- mantenha a verificação de nonce ligada.

### 3. Vercel

Em *Settings → Environment Variables* do projeto `lumeo-livros`, defina para **Production**:

- `VITE_GOOGLE_CLIENT_ID` = o Client ID do passo 1

A variável é embutida no build, então é preciso **publicar de novo** depois de criá-la.

## Erros que o usuário pode ver

| Situação | Mensagem |
|---|---|
| sem `VITE_GOOGLE_CLIENT_ID` no build | "O login com Google ainda não está configurado." |
| provedor Google desligado no Supabase | "O login com Google ainda não está configurado." (`GOOGLE_AUTH_NOT_CONFIGURED`) |
| token ou nonce recusado | "Não foi possível confirmar sua conta Google. Tente novamente." (`GOOGLE_TOKEN_INVALID`) |
| servidor em modo local | `GOOGLE_AUTH_UNAVAILABLE` (501) |
| troca de aparelho com outra conta Google | a troca é recusada e a sessão é encerrada |
