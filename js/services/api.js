// Cliente comum para chamadas protegidas à API da Vercel.
import { auth } from "./firebase-config.js";

export async function requisitarApiAdmin(caminho, opcoes = {}) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error("Entre na sua conta para realizar esta ação.");
  // Renovar o token evita que uma sessão antiga gere 401 após um novo deploy.
  const token = await usuario.getIdToken(true);
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      Accept: "application/json",
      ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
      ...opcoes.headers,
      Authorization: `Bearer ${token}`
    }
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || "Não foi possível concluir a solicitação.");
  return dados;
}
