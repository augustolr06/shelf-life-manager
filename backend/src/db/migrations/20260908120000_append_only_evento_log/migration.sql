-- RNF05 — `EventoLog` é append-only.
--
-- Até T09 a regra era convenção: estava no CLAUDE.md e na revisão de código,
-- e nada no sistema a impunha. Como o log é o **instrumento de coleta de
-- dados do TCC** (RF12), e não só auditoria interna, o risco que importa não
-- é o backend chamar `update` por engano — é alguém abrir o Prisma Studio ou
-- o `psql` durante o piloto na loja para "corrigir" uma linha. Uma trava no
-- código da aplicação não alcança esse caminho; o trigger alcança todos.
--
-- Deliberadamente NÃO cobre `TRUNCATE`: trigger de linha não dispara nessa
-- operação, e é isso que mantém `limparBanco` funcionando entre os testes.
-- A distinção é a mesma que a RNF05 faz — ela proíbe `UPDATE`/`DELETE`, e
-- zerar um banco descartável não é a aplicação alterando o histórico.

CREATE OR REPLACE FUNCTION eventolog_somente_insercao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'EventoLog e append-only (RNF05): % recusado. O log e instrumento de coleta do TCC; um evento gravado nao se corrige, se complementa com um evento novo.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER eventolog_append_only
  BEFORE UPDATE OR DELETE ON "EventoLog"
  FOR EACH ROW EXECUTE FUNCTION eventolog_somente_insercao();
