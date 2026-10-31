// Static request page: no backend call, persistence, account action or success simulation.
(() => {
  const COPY = {
    "pt-BR": { subject: "Lumeo Android — Solicitação de exclusão de conta", request: "Solicito a exclusão da minha conta Lumeo Android e dos dados pessoais associados.", account: "E-mail da conta Google utilizada no Lumeo",
      terms: ["Entendo que a titularidade da conta será verificada antes da exclusão.", "Peço que o suporte informe o alcance da exclusão, eventuais dados sujeitos a retenção e os prazos aplicáveis após avaliação.", "Entendo que excluir a conta não cancela automaticamente assinaturas nem gera reembolso."],
      opened: "Tentamos abrir seu aplicativo de e-mail. Nada foi enviado pelo site. Revise a mensagem e toque em Enviar no seu aplicativo. Se nada abrir, use o link abaixo ou escreva diretamente para delima20k@gmail.com.", failed: "Não foi possível abrir o aplicativo de e-mail. Nada foi enviado. Use o link abaixo ou envie a mensagem diretamente para delima20k@gmail.com." },
    "pt-PT": { subject: "Lumeo Android — Pedido de eliminação de conta", request: "Peço a eliminação da minha conta Lumeo Android e dos dados pessoais associados.", account: "E-mail da conta Google utilizada no Lumeo",
      terms: ["Compreendo que a titularidade da conta será verificada antes da eliminação.", "Peço que o apoio informe o alcance da eliminação, eventuais dados sujeitos a retenção e os prazos aplicáveis após avaliação.", "Compreendo que eliminar a conta não cancela automaticamente assinaturas nem gera reembolso."],
      opened: "Tentámos abrir a sua aplicação de e-mail. Nada foi enviado pelo site. Reveja a mensagem e toque em Enviar na sua aplicação. Se nada abrir, utilize a ligação abaixo ou escreva diretamente para delima20k@gmail.com.", failed: "Não foi possível abrir a aplicação de e-mail. Nada foi enviado. Utilize a ligação abaixo ou envie a mensagem diretamente para delima20k@gmail.com." },
    en: { subject: "Lumeo Android — Account deletion request", request: "I request the deletion of my Lumeo Android account and the associated personal data.", account: "Email of the Google account used in Lumeo",
      terms: ["I understand that account ownership will be verified before deletion.", "Please let me know the scope of the deletion, any data subject to retention and the applicable timing after review.", "I understand that deleting the account does not automatically cancel subscriptions or trigger a refund."],
      opened: "We tried to open your email app. Nothing was sent by this site. Review the message and tap Send in your app. If nothing opens, use the link below or write directly to delima20k@gmail.com.", failed: "Your email app could not be opened. Nothing was sent. Use the link below or send the message directly to delima20k@gmail.com." },
    es: { subject: "Lumeo Android — Solicitud de eliminación de cuenta", request: "Solicito la eliminación de mi cuenta de Lumeo Android y de los datos personales asociados.", account: "Correo de la cuenta de Google usada en Lumeo",
      terms: ["Entiendo que se verificará la titularidad de la cuenta antes de la eliminación.", "Pido que el soporte informe del alcance de la eliminación, de los posibles datos sujetos a retención y de los plazos aplicables tras la evaluación.", "Entiendo que eliminar la cuenta no cancela automáticamente las suscripciones ni genera un reembolso."],
      opened: "Intentamos abrir tu aplicación de correo. El sitio no envió nada. Revisa el mensaje y toca Enviar en tu aplicación. Si no se abre nada, usa el enlace de abajo o escribe directamente a delima20k@gmail.com.", failed: "No se pudo abrir la aplicación de correo. No se envió nada. Usa el enlace de abajo o envía el mensaje directamente a delima20k@gmail.com." },
  };
  const form = document.getElementById("exclusion-request");
  const email = document.getElementById("account-email");
  const fields = document.getElementById("request-fields");
  const status = document.getElementById("request-status");
  const fallback = document.getElementById("email-fallback");
  if (!form || !email || !fields || !status || !fallback) return;

  form.addEventListener("submit", event => {
    event.preventDefault();
    email.value = email.value.trim();
    if (!form.reportValidity() || /[\r\n]/.test(email.value)) return;
    const copy = COPY[String(window.location.hash).slice(1)] ?? COPY["pt-BR"];
    const body = [copy.request, "", `${copy.account}: ${email.value}`, "", ...copy.terms].join("\r\n");
    const href = `mailto:delima20k@gmail.com?subject=${encodeURIComponent(copy.subject)}&body=${encodeURIComponent(body)}`;
    fallback.href = href;
    status.textContent = copy.opened;
    try { window.location.assign(href); }
    catch { status.textContent = copy.failed; }
  });
  // Disabled by default so a missing/blocked script never submits an email into the site's URL.
  fields.disabled = false;
})();
