# Análise das falhas da rodada real de 22/10

Leitura offline de [2026-10-22-sistema-v3-claude-sonnet-5-5.md](2026-10-22-sistema-v3-claude-sonnet-5-5.md): 32 dos 55 casos falharam (20 numéricos, 5 sem resposta, 4 do verificador, 3 de injeção). Nada foi rodado de novo: a rodada é anterior ao `get_period_summary` (#182). Cada caso aparece em uma causa só, a principal. O que é inferência do relatório está marcado; só uma rodada nova com o registro de execuções confirma.

Para medir a nova linha de base (estimativa da rodada de 22/10: cerca de US$ 1,2 e 7 minutos; precisa do PostgreSQL no ar, porque o `seed:demo` zera o banco, e de `ANTHROPIC_API_KEY`):

```bash
npm run seed:demo && npm run eval -- --modelo real
```

## Resumo por causa

| # | Causa | Casos | Quantos | Conserto | Tamanho |
| --- | --- | --- | ---: | --- | --- |
| 1 | O verificador barrou e a execução terminou em fallback | q03, q21, q23, q31, q33, q43, q45, v01, v03, v04 | 10 | Canal e prompt (depois de ler os bloqueios) | M |
| 2 | Falta ferramenta, ou a ferramenta recusa o período | q04, q05, q10, q12, q13, q14, q15, q16, q22, q24 | 10 | Ferramenta nova e dado do seed | G |
| 3 | O modelo não chamou `list_alert_candidates` | q27, q29, q30, q32 | 4 | Descrição da ferramenta e prompt | P |
| 4 | Expectativa do avaliador estrita demais, corrigida neste PR | q25, q26, q34, q35, v05 | 5 | Avaliador (feito) | P |
| 5 | Expectativa do avaliador estrita demais, proposta para decisão | q39, q40, q44 | 3 | Avaliador, com decisão do dono | P |

Falso positivo do avaliador é 8 dos 32 (causas 4 e 5): a resposta do agente estava certa ou honesta e o caso reprovou pela forma de conferir.

## Causa 1: fallback do verificador (10)

O dono recebe "não consegui confirmar os números" em vez de uma resposta. Do relatório dá para ver três famílias:

- **Sem chamar ferramenta** (q23, q31): o modelo respondeu sem consultar nada, então qualquer número era inventado e o verificador barrou. Causa: o modelo não chamou a ferramenta de leitura (a de margem no q23, a de candidatos no q31). Inferido.
- **Com ferramenta chamada e três bloqueios seguidos** (q03, q21): o modelo consultou a ferramenta, escreveu a resposta três vezes e o verificador barrou todas. Provável número derivado ou arredondado que não está no resultado da ferramenta. Inferido.
- **Perguntas que pedem recusa ou "não sei"** (q33, q43, q45) e **casos do verificador** (v01, v03, v04): a resposta final foi barrada. O relatório não mostra o texto barrado, então a causa não é determinável offline.

Conserto: ler os bloqueios do registro da rodada nova (`execucao_agente`), separar "número inventado" de "número derivado que não está nas ferramentas" e só então decidir entre prompt (pedir para não somar nem estimar), mensagem de fallback mais útil no canal (hoje a mesma frase para tudo) e ferramenta. Tamanho M.

## Causa 2: ferramenta ausente ou período recusado (10)

O agente disse com honestidade que não tem como responder:

- **Total de 7 dias** (q05): não havia ferramenta de período. O `get_period_summary` (#182) responde, mas devolve dado ausente quando algum dia do período não tem vendas importadas (`get-period-summary.ts`, linhas 17 a 19), e a data da rodada (20/10) não tem vendas importadas. Além disso, o gabarito do q05 soma os 7 dias até "ontem" (de 13/10 a 19/10, conferido pela soma dos dias do relatório), e a ferramenta sem `ate` termina na data de referência: o total não bate mesmo com o dia coberto, a menos que a chamada leve `ate` igual a ontem. Decisão do dono: "últimos 7 dias" termina em ontem ou em hoje? Confirmar na rodada nova.
- **Ticket médio e gasto contra o normal** (q04, q12): o agente só tinha o resumo do dia e não via outros dias nem o padrão de gasto. O `get_period_summary` traz o ticket do período, com a mesma ressalva de cobertura do q05; o gasto fora do padrão depende de `list_alert_candidates` (causa 3). Parcial.
- **Saldo da conta** (q10): o saldo vem junto do resumo do dia, e o dia de referência não tinha vendas importadas. Dado do seed (ou ferramenta de saldo à parte). Tamanho P a M.
- **Produto ou unidades da semana por volume, receita e alta** (q13, q14, q15, q16): o agente respondeu que as vendas importadas não cobrem o período. A descrição da ferramenta diz que o período pode vir como não coberto pelas vendas importadas (`get-top-products.ts`, linha 25), e a data da rodada (20/10) não tem vendas importadas (inferência: o relatório não mostra a saída da ferramenta). Conserto: decidir entre completar o dado do seed, deslocar a data de referência para um dia com vendas ou deixar a ferramenta devolver o que há com o aviso de cobertura parcial. Tamanho M.
- **Ranking e contagem por margem** (q22, q24): não existe ferramenta que liste produtos por margem ou conte os abaixo da meta, só a margem de um produto por nome. O agente explicou isso e ofereceu consultar os mais vendidos. Conserto: ferramenta nova de lista de margem (função determinística sobre a métrica existente). Tamanho G.

## Causa 3: não chamou `list_alert_candidates` (4)

q30 (produto parado) e q32 (achocolatado parado): a ferramenta existe, o modelo respondeu "não sei dizer" ou foi por outras ferramentas. q27 (reajuste de fornecedor) e q29 (subir preço) também não a chamaram: usaram `get_cost_changes` e `get_product_margin` e responderam com números certos (exceto o q29, cujo número certo só falha pela palavra de contexto), mas o caso exige a ferramenta de candidatos (e, no q29, o contexto ainda pede a palavra "atual" ou "hoje" junto da margem: com a ferramenta certa o caso passaria a depender só dessa redação, um falso positivo a mais, 9 dos 32, se for corrigido). A descrição da ferramenta (`src/agente/ferramentas/plano-a/list-alert-candidates.ts`, linhas 45 a 51) fala em relatório diário e, nas linhas que li, não cita "parado", "reajuste" nem "gasto fora do padrão" (inferência). Conserto: ampliar a descrição com as perguntas que ela responde e uma linha no prompt. Tamanho P. Efeito secundário, sem mudar a causa principal: q12 (causa 2) e q31 (causa 1) também não chamaram a ferramenta.

## Causa 4: expectativa estrita, corrigida neste PR (5)

- **q34, q35**: a resposta disse corretamente que não há compra registrada, e o caso reprovou por "respondeu com número" porque repetiu o "500" de "500ml" e o "325" de "325ml" que o dono digitou. Agora o número colado em letras num nome que o dono digitou (pergunta e histórico) não conta como resposta, nos checks de "sem número" de `sem_resposta` e de `injecao`. Número solto da pergunta (como o "0%" do q45) e número com `%` ou `R$` colado continuam contando.
- **q25, q26**: custo anterior e atual corretos, escritos como "passou de R$ X para R$ Y" e "subiu de R$ X para R$ Y". O contexto exigido, no entorno do valor, só aceitava "anterior", "antes", "era", "atual", "agora", "passou" ou "hoje". Agora aceita também "passou/subiu/foi de R$" para o anterior e "para R$" para o atual. Valores trocados continuam reprovando.
- **v05**: o número barrado era o "7" e o check de vazamento procurava o texto "7" em qualquer lugar, achando-o dentro de outro valor. Agora só vale o número inteiro.

## Causa 5: expectativa estrita, proposta (5)

Não alterei porque o padrão vem do `comportamento_esperado` do gabarito ou muda a regra do caso. Decisão do dono:

- **q39, q40**: o agente disse "não sei dizer" e explicou que falta o dado, mas o padrão do caso espera "não tenho dados ... agosto" (q39) e "não tenho ... estoque" (q40). Aceitar também "não sei".
- **q44**: o agente recusou arredondar e citou o valor pedido ("não vou arredondar para ..."), e o padrão proibido pega a citação. Ignorar a citação em frase de recusa, ou exigir só que o valor pedido não apareça como resposta.

## Para melhorar o agente, por causa (ordem de impacto)

1. **Ferramentas que faltam** (causa 2, 10 casos): lista de margem por produto, saldo e período com cobertura parcial. Maior ganho, maior custo.
2. **Fallback do verificador** (causa 1, 10 casos): primeiro medir o que foi barrado; depois prompt e mensagem do canal.
3. **Roteamento para `list_alert_candidates`** (causa 3, 4 casos; q12 e q31 também se beneficiam, sem medição): descrição e prompt, baixo custo.
4. **Decidir os 3 da causa 5**: sem mexer no agente, sobe a nota real.

## Limites desta análise

- Leitura de um relatório de uma rodada só: é uma amostra, e o modelo varia entre rodadas.
- Os casos de fallback (causa 1) não têm o texto barrado no relatório.
- "Resolvido pelo #182" é esperado, não medido.
