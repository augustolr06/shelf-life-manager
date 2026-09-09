-- T18 — um `Alerta` por par (unidade, configuração), garantido pelo banco.
--
-- A varredura periódica (RF08) roda repetidamente sobre o mesmo estoque, e a
-- pergunta central dela é "já alertei sobre esta unidade nesta janela?". O
-- alerta é a notícia de que a unidade **entrou** na janela daquela
-- configuração, não um lembrete diário — então a resposta é permanente, e é
-- ela que torna a varredura idempotente: rodar dez vezes no mesmo dia produz
-- o mesmo estado que rodar uma.
--
-- A garantia fica no banco, e não só na aplicação como acontece com a
-- unicidade de `ConfiguracaoAlerta.diasAntecedencia` (T17). A diferença que
-- justifica: lá quem escreve é uma gestora mexendo em configuração de vez em
-- quando; aqui quem escreve é um job automático, sem ninguém olhando, e a
-- contagem de alertas emitidos é dado da pesquisa (RF13). Além disso este
-- índice é total, e não parcial — cabe no Prisma sem SQL cru, que era a razão
-- de T17 não o ter feito.

-- CreateIndex
CREATE UNIQUE INDEX "Alerta_unidadeId_configuracaoId_key" ON "Alerta"("unidadeId", "configuracaoId");
