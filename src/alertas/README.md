# alertas

Motor de regras que gera candidatos a alerta com prioridade. Issues: #43 a #46.

Quem decide o que vai na mensagem do dia é o agente (`select_alerts`, no máximo 3). O motor só lista candidatos na tabela `alerta` com status `candidato`; os números de cada alerta vêm das métricas de [src/metricas](../metricas/README.md); o motor só soma o impacto em reais, com contas inteiras sobre eles.

## Regras (#43)

Uma regra por `tipo_alerta`, em `regras.ts`. Cada uma lê a métrica e compara com o limite do comerciante; o motor roda as sete em `motor-de-alertas.ts` e é idempotente (`comerciante + tipo + chave + data` é único).

| Tipo | Vira candidato quando | Chave |
| --- | --- | --- |
| `reajuste_de_custo` | variação de custo acima de 5% e compra de no máximo 7 dias | produto, fornecedor e data da compra |
| `margem_abaixo_da_meta` | margem do produto abaixo da meta | produto |
| `espaco_para_subir_preco` | giro alto e margem abaixo da meta | produto |
| `giro_em_alta` | entre os de maior alta do giro, com alta acima de 0 | produto |
| `estoque_parado` | mais de 30 dias sem venda | produto |
| `ticket_medio_em_queda` | ticket do dia 30% ou mais abaixo da média dos 28 dias | dia |
| `gasto_fora_do_padrao` | desvio robusto do gasto operacional acima de 3 | dia |

Dado ausente nunca é zero: a regra não gera candidato e o motivo volta em `ausentes` no resultado do motor (por exemplo, `historico_insuficiente` na Esquina, que tem 14 dias de dados).

Os limites iniciais são os `PARAMETROS_*` das métricas (`limites.ts`). Cada comerciante pode sobrepor os seus por uma `FonteDeLimites`; a fonte padrão não sobrepõe nada. Janelas e tamanho de ranking continuam os da métrica.

## Prioridade e ordem (#44)

Nível de 1 (mais importante) a 3, por critério em `prioridade.ts`:

1. **Impacto em reais**, calculado em código com inteiros em centavos:
   - reajuste: diferença de custo por unidade vezes as unidades vendidas nos últimos 7 dias;
   - margem abaixo da meta: perda por unidade até a meta vezes as unidades da janela de preço;
   - espaço para subir preço: perda por unidade até a meta vezes as unidades dos últimos 7 dias;
   - ticket médio: (média de 28 dias menos ticket do dia) vezes os cupons do dia;
   - gasto fora do padrão: valor do dia menos a mediana.
2. Impacto de R$ 500 ou mais é prioridade 1; de R$ 100 a R$ 499,99, prioridade 2; abaixo disso, 3.
3. Sem impacto em reais (giro em alta, estoque parado, ou reajuste sem giro) o candidato fica em 3: sem número, sem urgência.
4. **Confiança** abaixo de 0,8, ou desconhecida, rebaixa um nível (até o 3).

Dentro do mesmo nível a ordem é: maior impacto, maior confiança, tipo e chave; `candidatos` do resultado do motor já vem nessa ordem. O impacto e a confiança ficam em `metricas_apoio` (`impacto_centavos`, `confianca`) junto com a procedência da métrica (`fonte`).

## Supressão (#44)

Um candidato não é gravado quando o mesmo alerta (tipo e chave) foi **enviado ou descartado** em uma data anterior há menos dias que a janela do tipo: 7 dias para os alertas por produto, então o enviado há 6 dias suprime e o enviado há 7 já não. Ticket e gasto têm chave por dia e não repetem. Alerta que ficou só `candidato` não suprime. Como a chave do reajuste inclui a data da compra, uma nota nova com outro reajuste do mesmo produto é um alerta novo.

## Job de reajuste após cada nota (#45)

Ao final da extração de uma nota (`extraido` ou `revisao`), a fila `extrair-nota` chama o gancho `APOS_EXTRACAO`, que enfileira o job `reajuste-pos-nota` (`jobs/fila-reajuste.ts`). O job (`jobs/verificar-reajuste.ts`) pega os produtos dos itens da nota, sempre com o `comerciante_id` do job, e roda no motor só a regra de reajuste restrita a eles, com a data de hoje.

- Idempotência: o `jobId` é comerciante + documento, e a unique de `alerta` segura qualquer repetição.
- O job só grava o candidato. O envio fica no relatório diário, que respeita no máximo 1 mensagem proativa por dia.
- Falha do gancho é registrada com o id do documento e não falha nem repete a extração: o relatório diário pega o mesmo reajuste de qualquer forma.
- Nota confirmada depois pelo dono (`revisao` para `extraido`) não reenfileira o job.

## Limites conhecidos

- As sobreposições por comerciante ainda não têm onde ser guardadas: não há coluna ou tabela de configuração no modelo de dados, então só a fonte padrão existe. Guardar exige migração.
- O relatório diário e `list_alert_candidates` ainda não leem os candidatos (#52).
