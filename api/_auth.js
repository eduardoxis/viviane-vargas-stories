import { getAuth } from "firebase-admin/auth";
import { obterDbAdmin } from "./_firebaseAdmin.js";

export async function exigirAdmin(req) {
  const cabecalho = String(req.headers.authorization || "");
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
  if (!token) {
    const erro = new Error("Não autenticado.");
    erro.status = 401;
    throw erro;
  }
  let usuario;
  // Falhas das variáveis da Vercel não são erro de sessão e devem ficar visíveis.
  obterDbAdmin();
  try {
    // O perfil ativo é conferido abaixo no Firestore. Não verificamos revogação
    // aqui porque ela exige uma chamada extra ao Auth Admin e pode falhar mesmo
    // para um token válido quando a conta de serviço não tem essa permissão.
    usuario = await getAuth().verifyIdToken(token);
  } catch (causa) {
    console.error("Erro ao validar token do administrador:", causa);
    const erro = new Error("Sessão inválida ou expirada. Saia e entre novamente.");
    erro.status = 401;
    throw erro;
  }
  const perfil = await obterDbAdmin().collection("vv_usuarios").doc(usuario.uid).get();
  if (perfil.data()?.role !== "admin") {
    const erro = new Error("Acesso restrito a administradores.");
    erro.status = 403;
    throw erro;
  }
  return usuario.uid;
}
