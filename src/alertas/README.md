# alertas

Motor de regras que gera candidatos a alerta com prioridade. Issues: #43 a #46.

Quem decide o que vai na mensagem do dia é o agente (`select_alerts`, no máximo 3). O motor só lista candidatos na tabela `alerta` com status `candidato`; os números de cada alerta vêm das métricas de [src/metricas](../metricas/README.md); o motor só soma o impacto em reais, com contas inteiras sobre eles.

## Regras (#43)

Uma regra por `tipo_alerta`, em `regras.ts`. Cada uma lê a métrica e compara com o limite do comerciante; o motor roda as sete em `motor-de-alertas.ts` e é idempotente (`comerciante + tipo + chave + data` é único). Repetir no mesmo dia com os mesmos dados não cria nem altera nada (ver "Candidato obsoleto" para o que muda quando os dados mudam).

| Tipo | Vira candidato quando | Chave |
| --- | --- | --- |
| `reajuste_de_custo` | variação de custo acima do limite, em compra recente (limites da métrica de variação de custo) | produto, fornecedor e id da compra atual |
| `margem_abaixo_da_meta` | margem do produto abaixo da meta | produto |
| `espaco_para_subir_preco` | giro alto e margem abaixo da meta | produto |
| `giro_em_alta` | entre os de maior alta do giro, com alta acima de 0 | produto |
| `estoque_parado` | mais dias sem venda que o limite do estoque parado | produto |
| `ticket_medio_em_queda` | queda do ticket do dia contra a média anterior chega ao limite do ticket médio | dia |
| `gasto_fora_do_padrao` | desvio robusto do gasto operacional acima do limite do gasto fora do padrão | dia |

Dado ausente nunca é zero: a regra não gera candidato e o motivo volta em `ausentes` no resultado do motor (por exemplo, `historico_insuficiente` na Esquina, que tem 14 dias de dados).

Os valores dos limites são das métricas: ficam nas constantes `PARAMETROS_*` de [src/metricas](../metricas/README.md) e na seção "Métricas determinísticas" de [docs/guia-desenvolvimento.md](../../docs/guia-desenvolvimento.md). `limites.ts` só os reaproveita como valor inicial. Cada comerciante pode sobrepor os seus por uma `FonteDeLimites`; a fonte do módulo (`FonteDeLimitesPostgres`, em `limites-do-comerciante.ts`) lê a tabela `limite_alerta`, onde vale a linha mais recente de cada limite, e `registrarLimite` valida nome e faixa antes de inserir. Janelas e tamanho de ranking continuam os da métrica.

## Prioridade e ordem (#44)

Nível de 1 (mais importante) a 3, por critério em `prioridade.ts`:

1. **Impacto em reais**, calculado em código com inteiros em centavos. Os que dependem de volume medem a **semana** (últimos 7 dias do giro); ticket e gasto medem o **dia** da data de referência, por natureza. Assim o mesmo fato tem a mesma prioridade em regras diferentes:
   - reajuste (semana): diferença de custo por unidade vezes as unidades vendidas nos últimos 7 dias;
   - margem abaixo da meta (semana): (preço-alvo menos preço médio) vezes as unidades dos últimos 7 dias, com preço-alvo = custo / (1 menos a meta), arredondado para cima para a meta ficar garantida;
   - espaço para subir preço (semana): o mesmo ganho por unidade vezes as unidades dos últimos 7 dias;
   - ticket médio (dia): (média de 28 dias menos ticket do dia) vezes os cupons do dia; é uma **estimativa aproximada**: subtrai dois valores já arredondados em centavos e multiplica pelos cupons, então o erro chega a meio centavo por cupom (cerca de R$ 2 com 400 cupons), o que pode mudar o nível perto dos limites;
   - gasto fora do padrão (dia): valor do dia menos a mediana.
2. Impacto de R$ 500 ou mais é prioridade 1; de R$ 100 a R$ 499,99, prioridade 2; abaixo disso, 3.
3. Sem impacto em reais (giro em alta, estoque parado, ou reajuste e margem sem giro) o candidato fica em 3: sem número, sem urgência.
4. **Confiança** abaixo de 0,8, ou desconhecida, rebaixa um nível (até o 3).

Dentro do mesmo nível a ordem é: maior impacto, maior confiança, tipo e chave; `candidatos` do resultado do motor já vem nessa ordem. O impacto e a confiança ficam em `metricas_apoio` (`impacto_centavos`, `menor_confianca`) junto com a procedência da métrica (`fonte`).

## Supressão (#44)

Um candidato não é gravado quando o mesmo alerta (tipo e chave) foi **enviado ou descartado** até a data de referência (o próprio dia incluído, para o tratado hoje antes de uma correção do dono) há menos dias que a janela do tipo: 7 dias para os alertas por produto, então o enviado há 6 dias suprime e o enviado há 7 já não. O **reajuste** é a exceção: a chave inclui a compra, então o mesmo reajuste já enviado ou descartado é suprimido sem limite de idade (nunca precisa voltar). Ticket e gasto têm chave por dia e não repetem. Alerta que ficou só `candidato` não suprime. A supressão só tem efeito depois que o status final (`enviado` ou `descartado`) é gravado no alerta: o motor só cria `candidato`, e quem grava o status é o ciclo do alerta (ver "Status final do alerta"). Como a chave do reajuste inclui o id da compra atual (duas compras do mesmo produto e fornecedor no mesmo dia são alertas distintos), uma nota nova com outro reajuste do mesmo produto é um alerta novo.

## Candidato obsoleto (#157)

Os status de `alerta` são `candidato`, `enviado`, `descartado` e `obsoleto` (migração `0010_alerta_obsoleto`). Quando o dono corrige um dado (por exemplo o custo de um item) e o motor roda de novo no mesmo dia:

- O candidato do dia que a regra **deixou de disparar** vira `obsoleto` e sai dos candidatos, do `select_alerts` e da supressão (que só olha `enviado` e `descartado`). A linha continua gravada (nada é apagado, regra 10).
- Só entram as regras que avaliaram com dado: uma regra sem dado (`ausentes`) não marca nada, porque sem dado não dá para dizer que o alerta deixou de valer. A regra de margem, que avalia produto a produto, só poupa os produtos sem custo ou sem venda.
- O candidato que **continua valendo** é atualizado no lugar (prioridade e métricas de apoio, com os números corrigidos), sem duplicar a linha, e o `obsoleto` que volta a valer é reativado como `candidato`. Só `candidato` e `obsoleto` se atualizam, e só quando algo mudou: `enviado` e `descartado` nunca são tocados.
- Uma execução por comerciante e dia de cada vez: `executar` roda dentro de uma trava do banco (`pg_advisory_xact_lock`), para o motor diário e o job pós-nota, que podem se sobrepor, não deixarem um número velho num candidato que a outra acabou de corrigir. A trava ocupa uma conexão do pool durante a execução, então no máximo 4 execuções seguram a trava ao mesmo tempo, somando todos os processos (vagas por `pg_try_advisory_xact_lock`, sem estado em memória, regra 11), para o pool (10) não esgotar com todas esperando conexão para as consultas. Quem não acha vaga não segura conexão: tenta de novo a cada 25 ms.
- A regra de margem e a de espaço para subir preço, que avaliam produto a produto, informam os produtos sem dado e os poupam.
- O **reajuste de custo nunca vira `obsoleto`**: a métrica só olha a compra atual do par, então uma nota nova do mesmo dia, a reemissão das leituras de uma nota ou a correção da nota anterior fariam a alta sumir sem ter sido refutada (e o contrário, deixar de marcar o que a correção refutou). Fica como limitação conhecida, para uma issue própria que recalcule a variação da compra do alerta. O reajuste que a regra ainda dispara continua sendo atualizado no lugar.
- O job pós-nota (`semRepetirGravados`) não considera o `obsoleto` como já gravado, e um candidato que continua valendo mas que o job não regrava não vira `obsoleto`.
- A correção do dono pode trocar a compra atual de um reajuste (a leitura corrigida passa a ser a mais recente) e, com ela, a chave. Para não reenviar o mesmo reajuste, um alerta `enviado` ou `descartado` do mesmo produto e fornecedor com o **mesmo custo novo e o mesmo custo anterior** vale como o mesmo reajuste por 7 dias, contando o próprio dia (`reajusteMesmoMovimentoDias`), mesmo sob outra chave (inclusive um alerta tratado hoje, antes da correção do dono). Só dentro da janela: o mesmo movimento de preço meses depois é outro reajuste.

## Status final do alerta (#155)

`ciclo-do-alerta.ts` (`CicloDoAlerta`) grava o que o motor não grava:

- `marcarEnviados(comerciante, execução)`: depois que a mensagem do relatório diário é entregue (`RelatorioDiarioService`, só quando o envio deu `enviada`), os alertas que o agente escolheu em `select_alerts` naquela execução passam de `candidato` para `enviado`, com `enviado_em`, `execucao_id` e a justificativa. Lê só as chamadas de `select_alerts` que deram certo e filtra comerciante nas duas tabelas. Os candidatos que o agente não escolheu (o teto é de 3 por dia) **continuam `candidato`**: ficar fora do teto não pode suprimir o alerta por 7 dias.
- Só vale a execução cujo resultado foi `aprovada`: num fallback (o verificador barrou, erro, recusa do modelo) o texto não traz os alertas escolhidos, e marcá-los os suprimiria por 7 dias sem o dono ter visto.
- Falha ao marcar é registrada com o id da execução e nunca desfaz o envio (regra 9: a mensagem do dia continua uma só). Se o processo cair entre entregar e marcar, o job reentregue cai em `ja_enviada_hoje` e `reconciliar` recupera a marcação pela execução da mensagem proativa do dia (idempotente), mas só quando a entrega foi confirmada (a mensagem tem o id externo, que é gravado depois do envio). Sem confirmação os alertas seguem `candidato`: erro de envio nunca suprime o que o dono não viu, e uma queda entre o envio e o id externo é tratada do mesmo jeito (volta amanhã).
- Vale só a **última** chamada de `select_alerts` bem-sucedida da execução (a escolha final do agente): cada chamada respeita o teto de 3, e somar várias passaria dele.
- Limite conhecido: o verificador de números não confere se o texto aprovado cita cada alerta escolhido; a escolha do agente é o que vale como "enviado".
- Nada é apagado (regra 10) e só se sai de `candidato` para `obsoleto` (que pode voltar a `candidato`): um alerta `enviado` ou `descartado` nunca volta atrás nem é regravado pelo motor (um `obsoleto` também não é marcado como enviado). A tabela `alerta` não tem gatilho de histórico imutável (esses são de `historico_custo`, `vinculo_descricao_produto` e `historico_preco_meta`); a mudança de status de um candidato não é apagar histórico.
- `descartar(comerciante, alerta, justificativa)` existe e está testado, mas **não tem quem chame**: o MVP não tem fluxo em que o dono descarta um alerta (nem ferramenta, nem tela). Quando houver, é ele que grava o `descartado`.

## Job de reajuste após cada nota (#45)

Ao final da extração de uma nota (`extraido` ou `revisao`), a fila `extrair-nota` chama o gancho `APOS_EXTRACAO`, que enfileira o job `reajuste-pos-nota` (`jobs/fila-reajuste.ts`). O job (`jobs/verificar-reajuste.ts`) pega os produtos dos itens da nota, sempre com o `comerciante_id` do job, e roda no motor só a regra de reajuste restrita a eles, com a data de hoje. O filtro é por produto: se o mesmo produto já tiver uma compra mais recente do mesmo fornecedor, o candidato gravado é o dessa compra (a chave leva o id dela), que pode não ser a da nota recém-processada.

- Idempotência: o `jobId` é comerciante + documento. A unique de `alerta` só segura a repetição no mesmo dia; por isso o job grava com `semRepetirGravados`, que não grava de novo um reajuste (tipo e chave) já existente em qualquer data. O motor diário não usa isso: o candidato de ontem que não foi enviado precisa voltar a ser candidato de hoje.
- O job só grava o candidato. O envio fica no relatório diário, que respeita no máximo 1 mensagem proativa por dia.
- Falha do gancho é registrada com o id do documento e não falha nem repete a extração: o relatório diário pega o mesmo reajuste de qualquer forma.
- Nota confirmada depois pelo dono (`revisao` para `extraido`) não reenfileira o job.

## Limites conhecidos

- No estoque parado, o limite do comerciante só vale a partir de 30 dias (o validador recusa valores abaixo disso), porque a métrica só marca parado acima desse corte e completa a lista com os mais próximos. Linha de `limite_alerta` fora da faixa, gravada sem passar por `registrarLimite`, é ignorada na leitura e, se for a mais recente, o limite volta ao padrão. Nenhum chamador grava limites ainda: a escrita pelo agente (com confirmação do dono, regra 7) fica para uma issue própria.
- O motor diário (as sete regras) é chamado pela ferramenta `list_alert_candidates` do agente (#52), que o roda para o comerciante e a data da sessão. O job de reajuste (#45) só avalia o reajuste após cada nota; ainda não há job que rode o motor diário sem o agente.
