# PRD — Sistema de Controle de Estoque por Unidade com FIFO por Data de Validade

**Contexto acadêmico:** TCC — Bacharelado em Sistemas de Informação, UNIFEI/IMC
**Tipo de pesquisa:** Aplicada, quali-quantitativa, estudo de caso único (perfumaria de pequeno porte)
**Status do documento:** Requisitos congelados. Decisões de design pendentes foram resolvidas (ver seção 6).
**Versão:** 2.0

---

## 1. Objetivo Principal

**Problema.** Perda financeira por vencimento de produtos em perfumaria de pequeno porte (~700 SKUs — perfumes, cosméticos, capilares, cuidados com a pele) que opera controle de estoque manual. A reposição chega em **caixas mistas**, não em lotes homogêneos, o que faz com que unidades do mesmo SKU coexistam em estoque com datas de validade distintas. No fluxo de atendimento, a vendedora pega a unidade mais acessível — não a mais próxima do vencimento.

**Proposta de valor central.** Rastreabilidade **por unidade física** (QR Code único colado em cada item) associada a uma regra de saída **FIFO ordenada por data de validade — não por data de entrada**. O controle de validade deixa de ser rotina de conferência periódica e passa a ser parte obrigatória do processo de venda.

**Lacuna endereçada (delimitação acadêmica).** Os sistemas correlatos mais próximos (Azizah & Kurnia; Halil et al.) usam código de barras **por SKU** e FIFO **por data de entrada**. Nenhum resolve o caso de unidades do mesmo SKU com validades diferentes. Essa é a contribuição do trabalho e **não pode ser diluída na implementação**.

---

## 2. Público-Alvo e Casos de Uso

### Atores

| Papel | Perfil | Dispositivo típico |
|---|---|---|
| `ATENDENTE` | Vendedora. Uso de alta frequência, baixa tolerância a fricção. | Celular (câmera para QR) ou desktop |
| `GESTOR` | Proprietário/gerente. Uso analítico, de configuração e de exceção. | Desktop / celular |

### Jornadas principais

**J1 — Entrada de estoque (`GESTOR`)**
Recebimento da caixa mista → cadastro/seleção do SKU → registro de cada unidade com sua data de validade → geração e impressão do QR Code único → colagem no produto físico.

**J2 — Saída com validação FIFO (`ATENDENTE`)** — *fluxo crítico do sistema*
Leitura do QR Code da unidade em mãos → o backend identifica a unidade `EM_ESTOQUE` **não vencida** do mesmo SKU com a menor `dataValidade` → se a unidade lida não for essa, o sistema **bloqueia a venda**, informa a data de validade da unidade correta e aguarda nova leitura → **o ciclo se repete** até que a unidade lida seja a prioritária → confirmação e baixa.

**J3 — Monitoramento proativo e decisão (`GESTOR`)**
Configuração da janela de antecedência (ex.: 30 dias) → verificação periódica de unidades dentro da janela → alerta/notificação → decisão comercial (promoção, destaque na vitrine) antes da perda.

---

## 3. Requisitos Funcionais

**RF01 — Autenticação e autorização.** Login com sessão; dois papéis (`ATENDENTE`, `GESTOR`) com permissões distintas. Toda ação de saída deve ser atribuível a um usuário (rastreabilidade para a pesquisa).

**RF02 — Cadastro de SKU (catálogo).** CRUD de produto-catálogo: código interno, nome, marca, categoria.

**RF03 — Cadastro de unidade individual.** Registro de unidade vinculada a um SKU, com data de validade obrigatória e identificador único. Deve suportar **cadastro em lote com validades diferentes por unidade** dentro da mesma sessão de recebimento.

**RF04 — Geração e impressão de etiquetas QR.** Renderização de etiquetas imprimíveis, em formato compatível com colagem em embalagens pequenas e irregulares.

**RF05 — Leitura de QR Code.** Captura via câmera do dispositivo (PWA) e entrada manual do código como *fallback*.

**RF06 — Validação FIFO por validade no momento da saída.** ⚠️ *Núcleo do sistema.*
Ao ler uma unidade, o sistema determina a unidade prioritária do mesmo SKU (menor `dataValidade` entre as `EM_ESTOQUE` **e não vencidas**). Se houver divergência: bloqueia, exibe a validade da unidade correta, permanece em espera e revalida a cada nova leitura, em laço, até a confirmação.

**RF07 — Registro de saída.** Baixa da unidade, mudança de status, timestamp, usuário responsável e número de tentativas até a leitura correta.

**RF08 — Alertas proativos configuráveis.** Janela de antecedência definida pelo usuário (em dias). Verificação periódica e emissão de alerta in-app e/ou notificação push.

**RF09 — Baixa por perda/descarte.** Registro de unidade vencida ou descartada, com motivo. Necessário para quantificar a perda — variável dependente da pesquisa.

**RF10 — Tratamento de unidade vencida no ponto de venda.** Ao ler uma unidade cuja `dataValidade` seja anterior à data corrente, o sistema **não** segue o fluxo FIFO normal. Apresenta três caminhos (detalhados na seção 6.1): correção de dado, baixa por descarte, ou override de venda restrito ao `GESTOR` com justificativa obrigatória.

**RF11 — Fila de descarte pendente.** Listagem, no painel do `GESTOR`, de todas as unidades `EM_ESTOQUE` com validade já expirada, para resolução ativa.

**RF12 — Registro de eventos (`EventoLog`).** Persistência estruturada e imutável de todos os eventos operacionais relevantes. **Duplo propósito:** auditoria do sistema e **instrumento de coleta de dados quantitativos do TCC**.

**RF13 — Dashboard e relatórios.** Unidades em estoque, unidades por faixa de vencimento, histórico de saídas, alertas FIFO disparados vs. substituições efetivas, perdas no período, overrides autorizados. *Prioridade menor que RF06/RF12 no cronograma de incrementos.*

---

## 4. Requisitos Não-Funcionais

**RNF01 — Integridade temporal.** `dataValidade` armazenada como `DATE`, nunca `DATETIME`/`TIMESTAMP`. Offset UTC corrompe a comparação FIFO e, por consequência, os dados da pesquisa.

**RNF02 — Atomicidade e concorrência.** A validação FIFO e a baixa da unidade ocorrem dentro de uma **única transação com lock a nível de banco**, impedindo dupla baixa da mesma unidade em atendimentos simultâneos.

**RNF03 — Coesão da regra de negócio.** A lógica FIFO reside em **uma única função server-side**, não distribuída entre frontend, controller e ORM. Requisito arquitetural inegociável — a validade do experimento depende de a regra ser única e auditável.

**RNF04 — Não-contornabilidade.** O bloqueio de RF06 não pode ser burlado pelo cliente. A decisão é sempre do servidor; o frontend apenas reflete o veredito.

**RNF05 — Imutabilidade do log.** `EventoLog` é *append-only*. Sem `UPDATE` ou `DELETE` por vias da aplicação.

**RNF06 — Performance no fluxo de venda.** Resposta da validação FIFO percebida como instantânea (alvo < 500 ms). O sistema está no caminho crítico do atendimento ao cliente; latência gera contorno do processo pela atendente.

**RNF07 — PWA e comportamento offline.** Instalável e responsivo (celular e desktop). A validação FIFO **exige conexão** — não pode ser resolvida com dados locais potencialmente desatualizados. Em modo offline, o fluxo de saída é bloqueado com mensagem explícita, e não degradado silenciosamente.

**RNF08 — Legibilidade física do QR.** Validar leitura em superfícies reais (frascos curvos, plásticos brilhantes, embalagens pequenas) sob a iluminação real da loja, **antes** de congelar o formato da etiqueta.

**RNF09 — Privacidade (LGPD).** O sistema não armazena dados de clientes. Dados pessoais limitam-se aos usuários operadores (nome, e-mail, credencial *hasheada*). Sem integração com PDV, sistema fiscal ou financeiro.

**RNF10 — Escala.** Dimensionado para ~700 SKUs e volume de unidades correspondente. Não otimizar prematuramente para escala superior.

### Fora de escopo (explícito)

- Sistema embarcado / ESP32
- Rastreamento de localização física em prateleira
- Integração com PDV, sistema fiscal ou financeiro
- Gestão de compras e fornecedores
- Carrinho de compras ou venda agrupada com estado persistido

---

## 5. Entidades e Dados

### Diagrama de relacionamentos

```
Usuario ──1:N──> Saida
   │
   ├──1:N──> Descarte
   │
   └──1:N──> EventoLog

Produto (SKU) ──1:N──> UnidadeProduto ──1:0..1──> Saida
                              │
                              ├──1:0..1──> Descarte
                              │
                              └──1:N──> EventoLog

ConfiguracaoAlerta ──1:N──> Alerta ──N:1──> UnidadeProduto
```

### Entidades

| Entidade | Descrição | Campos-chave |
|---|---|---|
| **Usuario** | Operador do sistema | `id`, `nome`, `email` (unique), `senhaHash`, `papel` (enum `ATENDENTE`/`GESTOR`) |
| **Produto** | SKU do catálogo — o *tipo* de produto | `id`, `codigoInterno` (unique), `nome`, `marca`, `categoria` |
| **UnidadeProduto** | **Entidade central.** Item físico individual | `id`, `produtoId` (FK), `codigoQr` (unique), `dataValidade` (**DATE**), `status` (enum), `dataEntrada`, `registradoPorId` (FK) |
| **Saida** | Evento de baixa por venda | `id`, `unidadeId` (FK, unique), `usuarioId` (FK), `dataHora`, `alertaFifoDisparado` (bool), `tentativasAteAcerto` (int), `vendaDeUnidadeVencida` (bool), `justificativaOverride` (nullable), `autorizadoPorId` (FK nullable), `sessaoVendaId` (nullable) |
| **Descarte** | Baixa por vencimento ou perda | `id`, `unidadeId` (FK, unique), `usuarioId` (FK), `dataHora`, `motivo` |
| **ConfiguracaoAlerta** | Parâmetro de antecedência | `id`, `diasAntecedencia`, `canal`, `ativo` |
| **Alerta** | Instância emitida | `id`, `unidadeId` (FK), `configuracaoId` (FK), `geradoEm`, `lidoEm` (nullable) |
| **EventoLog** | Log *append-only* / instrumento de pesquisa | `id`, `tipoEvento` (enum), `unidadeId` (nullable), `produtoId` (nullable), `usuarioId` (FK), `payload` (JSON), `ocorridoEm` |

### Regras de modelagem

- **`status` de `UnidadeProduto` = `EM_ESTOQUE | VENDIDA | DESCARTADA`.** Não existe status `VENCIDA`: "vencida" é um predicado derivado de `dataValidade < hoje`, não um estado persistido. Persistir exigiria um job diário para virar o flag, e qualquer falha desse job corromperia os dados da pesquisa.
- **Relacionamento crítico:** `Produto 1:N UnidadeProduto` é o que viabiliza a contribuição do trabalho. Modelar quantidade como um inteiro em `Produto` invalidaria a proposta inteira.
- **`sessaoVendaId`** é um UUID nullable gerado no cliente. Não cria estado nem regra de negócio — apenas agrupa saídas do mesmo atendimento para fins de relatório.

### Índices obrigatórios

```
UnidadeProduto(produtoId, status, dataValidade)   -- sustenta a consulta FIFO (executada a cada leitura)
UnidadeProduto(codigoQr)                          -- UNIQUE
```

### Tipos de evento no `EventoLog`

| Evento | Momento |
|---|---|
| `UNIDADE_CADASTRADA` | Entrada de estoque |
| `LEITURA_QR_SAIDA` | Toda leitura no fluxo de venda |
| `ALERTA_FIFO_DISPARADO` | Unidade lida não é a prioritária |
| `SAIDA_CONFIRMADA` | Baixa efetiva por venda |
| `TENTATIVA_VENDA_UNIDADE_VENCIDA` | Leitura de unidade com validade expirada |
| `VENDA_VENCIDA_AUTORIZADA` | Override executado pelo `GESTOR` |
| `VALIDADE_CORRIGIDA` | Correção de dado (payload guarda valor anterior e novo) |
| `DESCARTE_REGISTRADO` | Baixa por perda |
| `ALERTA_PROATIVO_EMITIDO` | Notificação de proximidade de vencimento |

---

## 6. Decisões de Design Resolvidas

### 6.1 Unidade já vencida no momento da venda

**Decisão:** o sistema **permite a saída mediante confirmação explícita registrada** — não bloqueia em definitivo.

**Implementação.** Ao detectar unidade vencida, a interface apresenta três caminhos, nesta ordem de proeminência visual:

| Caminho | Quando se aplica | Efeito no sistema |
|---|---|---|
| **Correção de dado** | A validade foi digitada errada no cadastro de entrada | Atualiza `dataValidade` da unidade, registra `VALIDADE_CORRIGIDA` com o valor anterior, e **revalida o FIFO** do zero |
| **Baixa por descarte** | A unidade está de fato vencida e não será vendida | Cria `Descarte`, status → `DESCARTADA`. É o dado mais valioso da pesquisa: a perda que se quer quantificar |
| **Override de venda** | Decisão comercial consciente | Cria `Saida` com `vendaDeUnidadeVencida = true`. **Restrito ao papel `GESTOR`**, com justificativa em texto livre obrigatória |

**Restrições de design.** O override **não é o botão primário da tela**. Os dois primeiros caminhos são a ação padrão; o override exige escalação de papel. Justificativa: a comercialização de produto com prazo de validade expirado é vedada pela legislação brasileira de defesa do consumidor, e o `EventoLog` é imutável — o registro do ato é permanente. A fricção deliberada protege o estabelecimento e é coerente com a mesma filosofia de design do bloqueio FIFO reativo, o que reforça o argumento no TCC2.

**Impacto na consulta FIFO.** Unidades vencidas são **excluídas do pool de candidatas prioritárias**:

```sql
unidadePrioritaria = min(dataValidade)
  WHERE produtoId = :sku
    AND status = 'EM_ESTOQUE'
    AND dataValidade >= :hoje      -- exclusão obrigatória
```

Sem essa exclusão, o laço FIFO apontaria uma unidade vencida como "a mais antiga" e empurraria ativamente produto vencido para o cliente — o oposto do objetivo do trabalho. As unidades excluídas alimentam a fila de descarte pendente (RF11).

### 6.2 Venda multi-item

**Decisão:** cada item é um **ciclo de validação FIFO independente e sequencial**. Não há carrinho nem validação em lote.

**Consequências arquiteturais:**

- Nenhuma entidade `Carrinho` / `VendaAgrupada` no schema. Cada `Saida` é atômica e autossuficiente.
- **Sem estado intermediário no servidor.** Se a atendente abandonar o ciclo no meio (cliente desistiu, laço de substituição interrompido), não há nada para limpar nem timeout de reserva a implementar — elimina uma classe inteira de bugs.
- **Janela de concorrência mínima:** o lock existe apenas durante a transação de baixa de uma unidade, não durante o tempo em que a atendente caminha até a prateleira.
- Agrupamento por atendimento, quando necessário para relatório, é feito via `sessaoVendaId` — um agrupador opcional, sem semântica transacional.

---

## 7. Especificação da Função de Validação FIFO

Função única, server-side, executada integralmente dentro de uma transação (RNF02, RNF03).

**Entrada:** `codigoQr`, `usuarioId`
**Saída:** veredito (`CONFIRMAR` | `BLOQUEAR_FIFO` | `EXCECAO_VENCIDO` | `ERRO`) + payload contextual

**Ordem das verificações:**

1. **QR existe?** → se não, `ERRO` (código não cadastrado)
2. **`status = EM_ESTOQUE`?** → se não, `ERRO` (unidade já vendida ou descartada)
3. **Unidade lida está vencida?** (`dataValidade < hoje`) → se sim, `EXCECAO_VENCIDO`. Ramifica para o fluxo da seção 6.1 e **não passa pelo FIFO**
4. **Unidade lida é a prioritária do pool não-vencido?** → se não, `BLOQUEAR_FIFO`: retorna a `dataValidade` da unidade correta, incrementa contador de tentativas, registra `ALERTA_FIFO_DISPARADO` e aguarda nova leitura (laço)
5. **Confirma:** `CONFIRMAR` → cria `Saida`, status → `VENDIDA`, grava `SAIDA_CONFIRMADA` no `EventoLog`

---

## 8. Ordem de Implementação (fatias verticais)

| # | Incremento | Justificativa |
|---|---|---|
| 1 | Auth + `Produto` + `UnidadeProduto` | Fundação do modelo de dados |
| 2 | **F2: saída com validação FIFO + `EventoLog`** | Núcleo acadêmico e instrumento de coleta. Primeiro a ser construído e testado |
| 3 | Fluxo de exceção de unidade vencida (6.1) | Completa o fluxo crítico |
| 4 | Cadastro em lote e geração de etiquetas | Viabiliza o piloto real na loja |
| 5 | Alertas proativos + fila de descarte | Suporte à decisão do gestor |
| 6 | Dashboard e relatórios | Consolidação dos dados de pesquisa |

**Pré-requisito ao incremento 2:** escrever os casos de teste da função de validação FIFO — incluindo todos os ramos da seção 7 — antes de escrever a implementação.

---

## 9. Rastreabilidade Acadêmica

- Manter `decisoes.md` com registro datado de cada decisão de design e sua justificativa. O log de decisões é rastreabilidade metodológica para a redação do TCC2.
- O `EventoLog` é instrumento de pesquisa: qualquer alteração no seu schema durante o desenvolvimento deve ser datada, pois quebra a comparabilidade dos dados coletados antes e depois.
- O documento TCC1 em LaTeX precisa ser atualizado para refletir as decisões das seções 6.1 e 6.2.
