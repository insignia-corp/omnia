# metricas

Margem por produto, variação de custo, maior giro, receita por produto, resumo diário, resumo da semana e do mês, ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço em funções puras, e o contrato de resultado que as ferramentas do agente devolvem. Issues: #32 a #41. Fórmulas, limites iniciais e as regras que o código aplica estão em [docs/guia-desenvolvimento.md](../../docs/guia-desenvolvimento.md) (seção "Métricas determinísticas"); estado e pendências em [docs/ESTADO.md](../../docs/ESTADO.md).

## Camadas

| Camada | Arquivos | Regra |
| --- | --- | --- |
| Funções puras | `margem-por-produto.ts`, `variacao-de-custo.ts`, `giro.ts`, `receita-por-produto.ts`, `resumo-diario.ts`, `resumo-de-periodo.ts`, `serie-de-faturamento.ts`, `ticket-medio.ts`, `gasto-fora-do-padrao.ts`, `estoque-parado.ts`, `espaco-para-subir-preco.ts`, `dia-contra-mesmos-dias.ts`, `movimento-de-produtos.ts`, `atencao.ts`, `briefing-diario.ts` | Recebem registros já lidos e a data de referência. Não leem banco nem relógio. Janelas, limites e desempates ficam aqui, com teste unitário ao lado. Os valores iniciais estão nas constantes `PARAMETROS_*` de cada arquivo. |
| Dados | `repositorio-metricas.ts` | Lê o PostgreSQL, sempre filtrando por `comerciante_id`, e devolve registros já lidos e somados (`dados-de-metricas.ts`): por dia (vendas e movimentos), por item de compra (custos), por produto (últimas vendas) ou o cadastro (produtos e contas). |
| Serviço | `metricas.service.ts` | Junta as duas camadas. É o que as ferramentas do agente (#50 a #52) chamam, com o `comerciante_id` da sessão, nunca do modelo. |

O `MetricasModule` está no `AppModule`. Para usar fora do Nest: `new MetricasService(new RepositorioMetricasPostgres(db))`.

## Contrato (`resultado-metrica.ts`)

Toda métrica devolve um `ResultadoMetrica<T>` ou um `DadoAusente`.

- `ResultadoMetrica`: `valor`, `periodo`, `n_registros` (linhas de origem usadas), `menor_confianca` (a pior entre vendas, item, nota e cadastro do produto) e `origens` (de onde vieram os dados, cadastro do produto incluído: `planilha`, `foto_nota`, `nfe`, `banco`, `dono`). O cadastro do produto pesa na confiança e na origem, mas não conta em `n_registros`.
- `DadoAusente`: `codigo` estável para o código decidir (`sem_custo`, `sem_venda_na_janela`, `dia_sem_dados`, `historico_insuficiente`...), `motivo` para o agente e, quando o dono resolve, `pergunta_sugerida`. A métrica nunca estima: sem custo, a margem não sai e o agente pergunta.
- Para o verificador de números: dinheiro em `*_centavos`, razões em `*_bps` inteiros e o mesmo valor pronto para exibir em `*_percentual` (2026 bps vira 20,26). O agente só pode citar números que estão no resultado.

## Métricas

| Métrica | Função | Observações |
| --- | --- | --- |
| Margem por produto (#33) | `calcularMargemDoProduto` | Preço médio de venda na janela de preço contra o custo da compra mais recente, de qualquer fornecedor. Meta do produto, ou a do comerciante. Devolve também o preço que leva a margem à meta, custo / (1 - meta) arredondado para cima em centavos (`precoParaMeta`, #182). |
| Variação de custo (#35) | `calcularVariacoesDeCusto` | Duas últimas compras do mesmo produto e do mesmo fornecedor, de notas diferentes. Devolve `acima_do_limite` e `recente`; quem decide o alerta é o motor (#43). |
| Maior giro (#34) | `calcularGiro` | Últimos dias contra a média semanal dos dias anteriores. A alta só vale para produto de média semanal mínima; rankings de alta e de volume. |
| Resumo diário (#40) | `calcularResumoDiario` | Faturamento, gastos, saldo do dia e da conta, ticket médio. Compara com o dia anterior, o mesmo dia da semana anterior e a média dos 7 dias anteriores. |
| Resumo da semana e do mês (#182) | `calcularResumoDePeriodo` | Semana: os 7 dias até a data contra os 7 anteriores. Mês: do dia 1 até a data contra os mesmos dias do mês anterior (fim limitado ao último dia dele). Dia do período fora das vendas importadas torna o resumo dado ausente (`periodo_sem_dados`); dia do período anterior fora das vendas deixa só a comparação ausente (`base_sem_dados`); gastos e saldo só quando o extrato cobre o período inteiro. Conferido contra `serie_diaria` do gabarito. |
| Receita por produto (#148) | `calcularReceitaPorProduto` | Soma em centavos do valor vendido nos últimos 7 dias, ranking dos de maior receita. Dado ausente enquanto as vendas importadas não cobrirem os 7 dias. |
| Margens de todos os produtos (#182, #194) | `margensDosProdutos` e `margensAbaixoDaMeta` (no serviço) | A margem de cada produto com a meta do produto ou a do comerciante; `margensAbaixoDaMeta` devolve só os abaixo da meta, da menor margem para a maior. Usadas pelo painel, pelo "Sugerir preço" e por `list_product_margins`. |
| Série de faturamento (#207) | `calcularSerieDeFaturamento` | Faturamento dia a dia da semana ou do mês, para o painel. Dia fora das vendas importadas vale nulo, não zero. |
| Espaço para subir preço (#36) | `calcularEspacoParaSubirPreco` | Derivada: junta o giro e a margem já calculados. Produto de giro alto com margem abaixo da meta; sem margem calculável fica de fora. |
| Ticket médio (#38) | `calcularTicketMedio` | Faturamento do dia por cupom contra a média ponderada do histórico (faturamento total / cupons totais). Exige o histórico completo importado. |
| Gasto fora do padrão (#39) | `calcularGastoForaDoPadrao` | Desvio robusto do gasto operacional do dia contra o histórico (mediana e desvio absoluto mediano), com mínimo de dias de extrato. Só categorias operacionais entram na série. O dia só vale quando todas as contas ativas abertas até ele (sem nenhuma ativa, todas as abertas até ele) têm extrato (cobertura por conta, `intervaloComumDeMovimentos`); o resumo diário segue a mesma regra para gastos, saldo do dia e saldo da conta (ausentes antes do início e depois do fim do período comum). O extrato de uma conta vale do primeiro dia com transação (ou, sem nenhuma, da abertura da conta, ou da própria sincronização quando a abertura não é conhecida) até o maior entre o último dia com transação e `conta.ultima_sincronizacao_em`, o último dia com extrato importado por inteiro, a data de corte e não o dia da execução (#166, preenchida por `registrarSincronizacaoDaConta`). Uma conta ativa parada, mas sincronizada, está em dia até a data da sincronização (o importador passa a data de corte, por exemplo ontem, quando o banco lança com atraso); uma conta ativa que nunca foi sincronizada e não tem transação (inclusive a aberta no próprio dia) deixa o dia sem total até a primeira importação. Dia coberto só pela data de sincronização, sem transação, vale gasto zero e não carrega origem de transação: a sincronização é metadado da conta (origem banco), não uma linha de dado. |
| Estoque parado (#37) | `calcularEstoqueParado` | Dias desde a última venda de produto já comprado. Traz todo produto parado e completa com os mais próximos do limite até o top N. |
| Resumo diário do pitch (`get_daily_briefing`) | `calcularDiaContraMesmosDias`, `calcularMaisVendidos`, `calcularPiores`, `calcularAtencao` e `montarBriefingDiario` (no serviço, `briefingDiario`) | O dia contra a média dos mesmos dias da semana nas 3 semanas anteriores (faturamento, vendas e ticket ponderado; variações sobre as médias exatas), dado ausente se faltar venda em algum desses dias. Mais vendidos: top 3 em unidades nos 7 dias até a data. Piores: top 3 maiores quedas em unidades contra os 7 dias anteriores, só com pelo menos 10 unidades na semana anterior. Atenção: até 3, um por produto, na ordem custo que subiu (compra nos 7 dias até a data acima do limite de reajuste do comerciante, contra a compra anterior do mesmo produto e fornecedor), margem abaixo da meta (menor primeiro) e 14 dias ou mais sem venda. `semanas` e `dias_da_janela_produtos` vão na saída para o verificador aceitar "as últimas 3 sextas" e "os últimos 7 dias". |

## Como conferir

- Unitários: `npm test -- src/metricas src/lib/datas`.
- Regressão contra o gabarito (#41): `npm run test:e2e -- tests/metricas-gabarito`. Carrega o seed, roda as métricas pelo serviço e compara dia a dia e produto a produto com `fixtures/gabarito/metricas.json`, que é calculado à parte por `scripts/fixtures/gabarito.ts`. O mesmo teste confere que os parâmetros padrão são os do gabarito e que um lojista não enxerga o produto do outro. O gabarito chama de `n_registros` as unidades vendidas (aqui, `unidades_vendidas`); o desempate dele é pelo id do fixture, que o banco não tem, então os rankings são comparados por grupos de empatados.

## Quem chama

As ferramentas do agente (`src/agente/ferramentas/plano-a`: `get_daily_summary`, `get_period_summary`, `get_top_products`, `get_product_margin`, `list_product_margins` e `get_cost_changes`), o motor de alertas (`src/alertas`), o painel do dono e a conversa (`src/canal`) chamam este serviço. Quem chama decide a data de corte: as ferramentas de período e o painel passam ontem (o último dia completo) quando não recebem outra; o serviço só usa a data de referência quando não recebe a data.
