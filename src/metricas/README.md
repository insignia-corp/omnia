# metricas

Margem por produto, variação de custo, maior giro, receita por produto, resumo diário, ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço em funções puras, e o contrato de resultado que as ferramentas do agente devolvem. Issues: #32 a #41. Fórmulas, limites iniciais e as regras que o código aplica estão em [docs/guia-desenvolvimento.md](../../docs/guia-desenvolvimento.md) (seção "Métricas determinísticas"); estado e pendências em [docs/ESTADO.md](../../docs/ESTADO.md).

## Camadas

| Camada | Arquivos | Regra |
| --- | --- | --- |
| Funções puras | `margem-por-produto.ts`, `variacao-de-custo.ts`, `giro.ts`, `receita-por-produto.ts`, `resumo-diario.ts`, `ticket-medio.ts`, `gasto-fora-do-padrao.ts`, `estoque-parado.ts`, `espaco-para-subir-preco.ts` | Recebem registros já lidos e a data de referência. Não leem banco nem relógio. Janelas, limites e desempates ficam aqui, com teste unitário ao lado. Os valores iniciais estão nas constantes `PARAMETROS_*` de cada arquivo. |
| Dados | `repositorio-metricas.ts` | Lê o PostgreSQL, sempre filtrando por `comerciante_id`, e devolve registros somados por dia (`dados-de-metricas.ts`). |
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
| Margem por produto (#33) | `calcularMargemDoProduto` | Preço médio de venda na janela de preço contra o custo da compra mais recente, de qualquer fornecedor. Meta do produto, ou a do comerciante. |
| Variação de custo (#35) | `calcularVariacoesDeCusto` | Duas últimas compras do mesmo produto e do mesmo fornecedor, de notas diferentes. Devolve `acima_do_limite` e `recente`; quem decide o alerta é o motor (#43). |
| Maior giro (#34) | `calcularGiro` | Últimos dias contra a média semanal dos dias anteriores. A alta só vale para produto de média semanal mínima; rankings de alta e de volume. |
| Resumo diário (#40) | `calcularResumoDiario` | Faturamento, gastos, saldo do dia e da conta, ticket médio. Compara com o dia anterior, o mesmo dia da semana anterior e a média da semana anterior. |
| Receita por produto (#148) | `calcularReceitaPorProduto` | Soma em centavos do valor vendido nos últimos 7 dias, ranking dos de maior receita. Dado ausente enquanto as vendas importadas não cobrirem os 7 dias. |
| Espaço para subir preço (#36) | `calcularEspacoParaSubirPreco` | Derivada: junta o giro e a margem já calculados. Produto de giro alto com margem abaixo da meta; sem margem calculável fica de fora. |
| Ticket médio (#38) | `calcularTicketMedio` | Faturamento do dia por cupom contra a média ponderada do histórico (faturamento total / cupons totais). Exige o histórico completo importado. |
| Gasto fora do padrão (#39) | `calcularGastoForaDoPadrao` | Desvio robusto do gasto operacional do dia contra o histórico (mediana e desvio absoluto mediano), com mínimo de dias de extrato. Só categorias operacionais entram na série. O dia só vale quando todas as contas ativas abertas até ele têm extrato (cobertura por conta, `intervaloComumDeMovimentos`); o resumo diário segue a mesma regra para gastos, saldo do dia e saldo da conta (ausentes antes do início e depois do fim do período comum). O extrato de uma conta vale até a data da última transação importada, porque o schema não guarda a data da última sincronização (#166): uma conta ativa parada (reserva, poupança) deixa de cobrir os dias depois da última transação dela e esses dias saem sem total de gastos, por cautela. O mesmo vale para uma conta ativa sem nenhuma transação importada, inclusive a aberta no próprio dia: o dia fica sem total até o extrato dela entrar. |
| Estoque parado (#37) | `calcularEstoqueParado` | Dias desde a última venda de produto já comprado. Traz todo produto parado e completa com os mais próximos do limite até o top N. |

## Como conferir

- Unitários: `npm test -- src/metricas src/lib/datas`.
- Regressão contra o gabarito (#41): `npm run test:e2e -- tests/metricas-gabarito`. Carrega o seed, roda as métricas pelo serviço e compara dia a dia e produto a produto com `fixtures/gabarito/metricas.json`, que é calculado à parte por `scripts/fixtures/gabarito.ts`. O mesmo teste confere que os parâmetros padrão são os do gabarito e que um lojista não enxerga o produto do outro. O gabarito chama de `n_registros` as unidades vendidas (aqui, `unidades_vendidas`); o desempate dele é pelo id do fixture, que o banco não tem, então os rankings são comparados por grupos de empatados.

## Pendente

As ferramentas do agente que chamam este serviço (#50 a #52) e o motor de alertas que escolhe os candidatos (#43) ainda não existem.
