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
  try {
    // Inicializa o Firebase Admin antes de validar o token.
    obterDbAdmin();
    usuario = await getAuth().verifyIdToken(token, true);
  } catch {
    const erro = new Error("Sessão inválida ou expirada.");
    erro.status = 401;
    throw erro;
  }
  const perfil = await obterDbAdmin().collection("mj_usuarios").doc(usuario.uid).get();
  if (perfil.data()?.role !== "admin") {
    const erro = new Error("Acesso restrito a administradores.");
    erro.status = 403;
    throw erro;
  }
  return usuario.uid;
}
