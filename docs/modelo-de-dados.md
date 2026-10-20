# Modelo de dados

Dono do fato: `src/infra/database/schema.ts` (Drizzle). Migrações em `drizzle/`. Este arquivo explica o desenho e traz o diagrama; se divergir do schema, o schema vence.

## Regras que valem para todas as tabelas

| Regra | Como o banco garante |
| --- | --- |
| Dinheiro em centavos inteiros | Colunas `bigint` com sufixo `_centavos`. Nenhum `numeric` ou `float` para dinheiro |
| `comerciante_id` em toda tabela com dado do lojista | Coluna `NOT NULL` com índice e chave estrangeira para `comerciante` |
| Isolamento entre lojistas | Tabela filha aponta para a mãe por chave composta `(id, comerciante_id)`. O banco recusa um item de venda do lojista A ligado à venda do lojista B |
| Origem e confiança em todo dado extraído ou informado | Colunas `origem` (`foto_nota`, `nfe`, `planilha`, `banco`, `dono`) e `confianca` (0 a 1, com `CHECK`) |
| Histórico nunca é sobrescrito nem apagado | `historico_custo` e `vinculo_descricao_produto` são append-only (gatilho `bloquear_alteracao_historico`) |
| Exclusão a pedido do lojista (LGPD) | `DELETE` em `comerciante` apaga tudo em cascata, inclusive o histórico |
| Nenhum estado em memória do processo | Perguntas pendentes ao dono, alertas e mensagens ficam no banco |

## Diagrama

```mermaid
erDiagram
  comerciante ||--o{ consentimento : "autoriza"
  comerciante ||--o{ conta : "tem"
  conta ||--o{ transacao : "movimenta"
  comerciante ||--o{ fornecedor : "compra de"
  comerciante ||--o{ produto : "vende"
  comerciante ||--o{ documento : "envia"
  documento ||--o| compra : "origina"
  fornecedor ||--o{ compra : "emite"
  compra ||--|{ item_de_compra : "contém"
  produto ||--o{ item_de_compra : "é comprado em"
  item_de_compra ||--o{ historico_custo : "registra custo"
  produto ||--o{ historico_custo : "tem"
  fornecedor ||--o{ historico_custo : "pratica"
  produto ||--o{ vinculo_descricao_produto : "é descrito por"
  documento ||--o{ venda : "importa"
  venda ||--|{ item_de_venda : "contém"
  produto ||--o{ item_de_venda : "é vendido em"
  comerciante ||--o{ alerta : "recebe"
  comerciante ||--o{ mensagem : "troca"
  comerciante ||--o{ pergunta_dono : "responde"
  item_de_compra ||--o{ pergunta_dono : "gera"
  comerciante ||--o{ execucao_agente : "dispara"
  execucao_agente ||--o{ chamada_ferramenta : "faz"
  execucao_agente ||--o{ alerta : "decide"
  execucao_agente ||--o{ mensagem : "escreve"
```

Toda tabela, exceto `comerciante`, também aponta para `comerciante` (omitido no diagrama para não poluir).

## Tabelas

| Tabela | Para que serve | Pontos de atenção |
| --- | --- | --- |
| `comerciante` | Lojista. Nome, WhatsApp, tipo e `margem_meta_bps` (meta de margem, 2500 = 25%) | A meta é configuração do próprio lojista, a única escrita permitida ao agente, e só após confirmação |
| `consentimento` | O que foi autorizado (`banco`, `notas`), quando e em qual versão do termo; `revogado_em` quando revogado | Uma linha por concessão |
| `conta` | Conta bancária conectada. Guarda só o id da conexão no agregador, nunca credenciais | `saldo_inicial_centavos` e `saldo_inicial_em` permitem calcular o saldo de qualquer dia |
| `transacao` | Entrada ou saída da conta, com `id_externo` único por conta para importar sem duplicar | Valor sempre positivo; o sentido está em `tipo` |
| `fornecedor` | Nome e CNPJ (só dígitos), único por comerciante | CNPJ ilegível ou com dígito errado entra nulo: cada nota vira um fornecedor próprio até o dono confirmar, em vez de juntar notas de fornecedores diferentes |
| `produto` | Catálogo. Código de barras e SKU únicos por comerciante, índice `pg_trgm` no nome | `preco_meta_centavos` e `margem_meta_bps` são as metas do dono, opcionais |
| `documento` | Arquivo enviado (foto, NF-e, planilha), com hash SHA-256 único por comerciante, status da extração (`pendente`, `processando`, `extraido`, `revisao`, `falha`), a saída do modelo já validada (`extracao_json`) e as divergências achadas em código (`motivos_validacao`) | O mesmo arquivo enviado duas vezes não vira dois documentos |
| `compra` | Nota de compra: fornecedor, data, total impresso e soma dos itens calculada em código | Total diferente da soma reduz a confiança |
| `item_de_compra` | Linha da nota. `produto_id` é nulo até a descrição ser ligada a um produto | `revisao_pendente` quando a confiança fica abaixo do limite |
| `vinculo_descricao_produto` | Descrição impressa na nota para produto, com o método (`codigo_barras`, `similaridade`, `modelo`, `dono`) | **Append-only**. Trocar um vínculo insere linha nova; vale a mais recente da chave |
| `historico_custo` | Custo por produto, fornecedor e data, uma linha por leitura do item de compra | **Append-only**. A correção do dono insere linha nova (origem `dono`, confiança 1) e vale a mais recente do item. Alimenta margem e variação de custo |
| `mapeamento_planilha` | Mapeamento de colunas de uma planilha de vendas (data, produto, quantidade, preço), identificado pela assinatura dos cabeçalhos e confirmado pelo dono uma vez | Único por `(comerciante, assinatura)` |
| `venda` e `item_de_venda` | Cupom e seus itens, vindos da planilha ou do PDV | `(comerciante, data, numero_cupom)` único: reimportar não duplica |
| `alerta` | Candidato a alerta com tipo, prioridade (1 a 3), números de apoio em JSON, status e justificativa do agente | `(comerciante, tipo, chave, data)` único: o motor é idempotente |
| `mensagem` | Mensagem enviada ou recebida, categoria do template, custo estimado e canal | No máximo uma proativa por dia por comerciante; chave de idempotência do job única |
| `pergunta_dono` | Pergunta do agente ao dono e a resposta, com status | Substitui qualquer estado de conversa em memória |
| `execucao_agente` e `chamada_ferramenta` | Observabilidade: gatilho, tokens, custo, latência, resultado do verificador e cada chamada de ferramenta | Já existiam desde a Etapa 0 |

## Histórico append-only

`UPDATE` em `historico_custo` e em `vinculo_descricao_produto` sempre falha. `DELETE` só passa em dois casos:

1. Em cascata, quando o lojista pede a exclusão (LGPD): o gatilho detecta que roda dentro de outro gatilho (`pg_trigger_depth() > 1`).
2. Quando a transação declara `SET LOCAL omnia.exclusao_autorizada = 'on'`, que a rotina de retenção e o seed usam.

Isso protege o ativo próprio do projeto (edital, seção 9.4): custo por produto, fornecedor e data, e vínculos confirmados pelo dono.

## Seed

`npm run seed:demo` zera o banco, aplica as migrações e carrega os `fixtures/`. `npm run db:seed` só recarrega. Detalhes em [fixtures/README.md](../fixtures/README.md).

O seed cria dois comerciantes, para testar o isolamento:

| Comerciante | Conteúdo |
| --- | --- |
| Mercadinho Vila Nova | Os fixtures inteiros: 50 produtos, 7 fornecedores, 18 notas, 3.623 cupons, 212 transações, 1 pergunta pendente |
| Conveniência Esquina 24h | Recorte menor: 12 produtos, últimas 2 semanas de vendas, meta de margem de 30% |

É idempotente e determinístico: os ids são UUIDs v5 de nomes fixos e as datas de criação são fixas, então `db:reset && db:seed` deixa o banco sempre no mesmo estado. Recusa rodar com `NODE_ENV=production`.
