# Gerência Viviane Vargas Stories — Sistema de Gestão

Sistema web completo para gestão de loja de produtos.

## Módulos

| Módulo | Acesso |
|--------|--------|
| Dashboard | Admin + Funcionário |
| Produtos / Estoque | Admin + Funcionário |
| Clientes | Admin |
| Despesas | Admin |
| Promissórias | Admin |
| Configurações / Usuários | Admin |

---

## Configuração Firebase

### 1. Criar projeto no Firebase
1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um novo projeto (ex: `viviane-vargas-stories`)
3. Ative **Authentication → E-mail/Senha**
4. Ative **Firestore Database** (modo produção)

### 2. Configurar credenciais
Edite o arquivo `js/firebase-config.js` e substitua os valores:

```js
const firebaseConfig = {
  apiKey:            "SUA_API_KEY",
  authDomain:        "SEU_PROJETO.firebaseapp.com",
  projectId:         "SEU_PROJETO",
  storageBucket:     "SEU_PROJETO.firebasestorage.app",
  messagingSenderId: "SEU_SENDER_ID",
  appId:             "SEU_APP_ID"
};
```

As credenciais ficam em: Firebase Console → Seu Projeto → ⚙️ Configurações → Seus apps → SDK do Firebase.

### 3. Criar o primeiro usuário (admin)
1. No Firebase Console → Authentication → Usuários → Adicionar usuário
2. Informe e-mail e senha do dono/admin
3. Copie o UID gerado
4. No Firestore → Dados → Crie a coleção `mj_usuarios`
5. Crie um documento com o **UID** como ID, com os campos:
   ```
   nome:     "Seu Nome"
   email:    "seu@email.com"
   role:     "admin"
   criadoEm: (timestamp atual)
   ```

> **Alternativa:** faça login no sistema pela primeira vez — o sistema cria o doc automaticamente como `admin`. Depois ajuste o `role` se necessário.

### 4. Publicar regras do Firestore
No Firebase Console → Firestore → Regras, cole o conteúdo de `firestore.rules`.

---

## Deploy na Vercel

1. Faça upload dos arquivos (ou conecte ao GitHub)
2. A Vercel detecta automaticamente como site estático
3. Não é necessária nenhuma configuração de build

---

## Estrutura de arquivos

```
gerencia-viviane-vargas-stories/
├── index.html           ← App principal (HTML + scripts)
├── firestore.rules      ← Regras de segurança do Firestore
├── css/
│   └── main.css         ← Todos os estilos
└── js/
    ├── firebase-config.js ← Credenciais Firebase ⚠️
    ├── database.js        ← Utilitários compartilhados
    ├── produtos.js        ← Módulo Produtos / Estoque
    ├── despesas.js        ← Módulo Despesas
    ├── clientes.js        ← Módulo Clientes
    ├── vendas.js          ← Histórico de Vendas por dia (aba do Caixa, admin)
    └── promissoria.js     ← Módulo Promissórias
```

---

## Coleções do Firestore

| Coleção | Descrição |
|---------|-----------|
| `mj_usuarios` | Usuários do sistema (admin/funcionário) |
| `mj_produtos` | Cadastro de produtos e estoque |
| `mj_custo_historico` | Histórico de alterações de preço de custo (margem) |
| `mj_clientes` | Clientes da loja |
| `mj_despesas` | Despesas da loja (descrição, categoria, tipo, valor, data, situação) |
| `prom_clientes` | Clientes com promissória |
| `prom_compras` | Histórico de compras fiadas |
| `prom_pagamentos` | Pagamentos das promissórias |

---

## Adicionar funcionários

1. Acesse: Firebase Console → Authentication → Adicionar usuário
2. Informe e-mail e senha do funcionário
3. Copie o UID
4. No sistema: Configurações → Novo Usuário → cole o UID e selecione "Funcionário"

O funcionário terá acesso apenas a **Dashboard** e **Produtos / Estoque**.
