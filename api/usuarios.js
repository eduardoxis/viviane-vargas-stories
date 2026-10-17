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

function mensagemSeguraDeFalha(erro) {
  const codigo = String(erro?.code || "");
  if (["app/invalid-credential", "auth/invalid-credential", "auth/invalid-service-account"].includes(codigo)) {
    return "A chave da conta de serviço do Firebase não foi aceita pela Vercel.";
  }
  if (["auth/insufficient-permission", "permission-denied", "firestore/permission-denied"].includes(codigo)) {
    return "A conta de serviço não tem permissão para criar contas ou perfis no Firebase.";
  }
  if (codigo === "auth/operation-not-allowed") {
    return "O login por e-mail e senha ainda não está ativado no Firebase Authentication.";
  }
  if (codigo === "auth/internal-error") {
    return "O Firebase não concluiu a criação da conta. Tente novamente em alguns instantes.";
  }
  return "Não foi possível criar o usuário. Confira as variáveis da Vercel e tente novamente.";
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
    const cargo = ["admin", "operador_caixa"].includes(role) ? role : "funcionario";

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
      erro: erro?.status ? erro.message : mensagemSeguraDeFalha(erro)
    });
  }
}
