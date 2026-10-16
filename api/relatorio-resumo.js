// Relatório administrativo protegido. É uma base para relatórios futuros
// que não devem confiar em totais enviados pelo navegador.
import { exigirAdmin } from "./_auth.js";
import { obterDbAdmin } from "./_firebaseAdmin.js";
import { aplicarLimite } from "./_rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ erro: "Método não permitido." });
  try {
    const uid = await exigirAdmin(req);
    aplicarLimite(`resumo:${uid}`, { maximo: 20, janelaMs: 10 * 60_000 });
    const db = obterDbAdmin();
    const [produtos, clientes, vendas] = await Promise.all([
      db.collection("mj_produtos").count().get(),
      db.collection("mj_clientes").count().get(),
      db.collection("mj_vendas").orderBy("criadoEm", "desc").limit(100).get()
    ]);
    const faturamentoRecente = vendas.docs.reduce((total, item) => total + Number(item.data().total || item.data().valorTotal || 0), 0);
    return res.status(200).json({
      produtos: produtos.data().count,
      clientes: clientes.data().count,
      vendasRecentes: vendas.size,
      faturamentoRecente
    });
  } catch (erro) {
    return res.status(erro.status || 500).json({ erro: erro.message || "Falha ao gerar relatório." });
  }
}
