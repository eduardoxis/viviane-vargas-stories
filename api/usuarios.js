import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { exigirAdmin } from "./_auth.js";
import { obterDbAdmin } from "./_firebaseAdmin.js";
import { aplicarLimite } from "./_rateLimit.js";

function falhar(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function lerCorpo(corpo) {
  if (!corpo) return {};
  if (typeof corpo === "string") {
    try {
      return JSON.parse(corpo);
    } catch {
      throw falhar("Dados do cadastro inválidos.");
    }
  }
  return corpo;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  let contaCriada;
  try {
    const administradorId = await exigirAdmin(req);
    aplicarLimite(`criar-usuario:${administradorId}`, { maximo: 10, janelaMs: 10 * 60_000 });

    const { nome, email, senha, role } = lerCorpo(req.body);
    const nomeLimpo = String(nome || "").trim();
    const emailLimpo = String(email || "").trim().toLowerCase();
    const senhaInicial = String(senha || "");
    const cargo = role === "admin" ? "admin" : "funcionario";

    if (!nomeLimpo || nomeLimpo.length > 100) throw falhar("Informe um nome válido.");
    if (!/^\S+@\S+\.\S+$/.test(emailLimpo) || emailLimpo.length > 254) throw falhar("Informe um e-mail válido.");
    if (senhaInicial.length < 6 || senhaInicial.length > 128) throw falhar("A senha deve ter entre 6 e 128 caracteres.");

    // obterDbAdmin inicializa o Firebase Admin antes do uso do Auth.
    const db = obterDbAdmin();
    contaCriada = await getAuth().createUser({
      displayName: nomeLimpo,
      email: emailLimpo,
      password: senhaInicial,
      disabled: false
    });

    await db.collection("vv_usuarios").doc(contaCriada.uid).set({
      nome: nomeLimpo,
      email: emailLimpo,
      role: cargo,
      ativo: true,
      criadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp(),
      ultimoLoginEm: null,
      criadoPor: administradorId
    });

    return res.status(201).json({
      uid: contaCriada.uid,
      nome: nomeLimpo,
      email: emailLimpo,
      role: cargo
    });
  } catch (erro) {
    if (contaCriada?.uid) {
      await getAuth().deleteUser(contaCriada.uid).catch(() => {});
    }

    if (erro?.code === "auth/email-already-exists") {
      return res.status(409).json({ erro: "Já existe uma conta com este e-mail." });
    }
    if (!erro?.status) console.error("Erro ao criar usuário:", erro);
    return res.status(erro?.status || 500).json({
      erro: erro?.status ? erro.message : "Não foi possível criar o usuário. Tente novamente."
    });
  }
}
