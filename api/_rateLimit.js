const historico = new Map();

export function aplicarLimite(chave, { maximo = 30, janelaMs = 60_000 } = {}) {
  const agora = Date.now();
  const recentes = (historico.get(chave) || []).filter((tempo) => agora - tempo < janelaMs);
  if (recentes.length >= maximo) {
    const erro = new Error("Muitas requisições. Aguarde um instante.");
    erro.status = 429;
    throw erro;
  }
  recentes.push(agora);
  historico.set(chave, recentes);
}
