-- Histórico append-only (regra inviolável 10): custo por produto, fornecedor e data, e vínculos
-- nota-produto confirmados nunca são atualizados nem apagados.
--
-- UPDATE é sempre recusado. DELETE só passa quando:
--   1. vem em cascata da exclusão do comerciante (LGPD): o gatilho roda dentro de outro gatilho,
--      então pg_trigger_depth() > 1; ou
--   2. a transação declara `SET LOCAL omnia.exclusao_autorizada = 'on'`, usado só pela rotina de
--      retenção e pela exclusão a pedido do lojista.
CREATE FUNCTION bloquear_alteracao_historico() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A tabela % é append-only: UPDATE não é permitido', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF pg_trigger_depth() > 1 OR current_setting('omnia.exclusao_autorizada', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é append-only: DELETE só na exclusão do lojista ou na retenção', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER historico_custo_append_only
  BEFORE UPDATE OR DELETE ON historico_custo
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_historico();
--> statement-breakpoint
CREATE TRIGGER vinculo_descricao_produto_append_only
  BEFORE UPDATE OR DELETE ON vinculo_descricao_produto
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_historico();
