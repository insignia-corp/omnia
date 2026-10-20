# metricas

Margem por produto, variação de custo, maior giro e resumo diário em funções puras, e o contrato de resultado que as ferramentas do agente devolvem. Issues: #32 a #41. Fórmulas e limites iniciais em [docs/guia-desenvolvimento.md](../../docs/guia-desenvolvimento.md) (seção "Métricas determinísticas"); estado e pendências em [docs/ESTADO.md](../../docs/ESTADO.md).

## Camadas

| Camada | Arquivos | Regra |
| --- | --- | --- |
| Funções puras | `margem-por-produto.ts`, `variacao-de-custo.ts`, `giro.ts`, `resumo-diario.ts` | Recebem registros já lidos e a data de referência. Não leem banco nem relógio. Janelas, limites e desempates ficam aqui, com teste unitário ao lado. |
| Dados | `repositorio-metricas.ts` | Lê o PostgreSQL, sempre filtrando por `comerciante_id`, e devolve registros somados por dia (`dados-de-metricas.ts`). |
| Serviço | `metricas.service.ts` | Junta as duas camadas. É o que as ferramentas do agente (#50 a #52) chamam, com o `comerciante_id` da sessão, nunca do modelo. |

O `MetricasModule` está no `AppModule`. Para usar fora do Nest: `new MetricasService(new RepositorioMetricasPostgres(db))`.

## Contrato (`resultado-metrica.ts`)

Toda métrica devolve um `ResultadoMetrica<T>` ou um `DadoAusente`.

- `ResultadoMetrica`: `valor`, `periodo`, `n_registros` (linhas de origem usadas), `menor_confianca` (a pior entre vendas, item e nota) e `origens` (de onde vieram os dados: `planilha`, `foto_nota`, `nfe`, `banco`, `dono`).
- `DadoAusente`: `codigo` estável para o código decidir (`sem_custo`, `sem_venda_na_janela`, `dia_sem_dados`...), `motivo` para o agente e, quando o dono resolve, `pergunta_sugerida`. A métrica nunca estima: sem custo, a margem não sai e o agente pergunta.
- Para o verificador de números: dinheiro em `*_centavos`, razões em `*_bps` inteiros e o mesmo valor pronto para exibir em `*_percentual` (2026 bps vira 20,26). O agente só pode citar números que estão no resultado.

## Métricas

| Métrica | Função | Observações |
| --- | --- | --- |
| Margem por produto (#33) | `calcularMargemDoProduto` | Preço médio dos últimos 30 dias (receita / unidades) contra o custo da compra mais recente, de qualquer fornecedor. Meta do produto, ou a do comerciante. |
| Variação de custo (#35) | `calcularVariacoesDeCusto` | Duas últimas compras do mesmo produto e do mesmo fornecedor, de notas diferentes. Devolve `acima_do_limite` e `recente`; quem decide o alerta é o motor (#43). |
| Maior giro (#34) | `calcularGiro` | 7 dias contra a média semanal dos 28 anteriores. Alta só entre produtos com média semanal mínima; rankings de alta e de volume. |
| Resumo diário (#40) | `calcularResumoDiario` | Faturamento, gastos, saldo do dia e da conta, ticket médio. Compara com o dia anterior, o mesmo dia da semana anterior e a média dos 7 dias anteriores. |

## Decisões que o código toma

- **Janelas inclusivas nas duas pontas.** Os 30 dias de preço terminam na data de referência e incluem ela.
- **Custo vigente.** Cada item de compra vale pela leitura mais recente de `historico_custo` (a correção do dono entra como linha nova e prevalece). O custo mais recente de um produto é o de maior data; empate desempata pela criação e depois pelo id.
- **Dia sem dado não é zero.** O resumo usa o intervalo das vendas importadas: dentro dele, dia sem cupom é loja fechada; fora dele, a comparação fica ausente. Um dia depois da última venda importada vira `dia_sem_dados`, em vez de faturamento zero.
- **Arredondamento.** Razões em bps e preço médio arredondam meio para cima, afastando do zero. Somas de quantidade (até 3 casas) são arredondadas em 3 casas para o ruído de ponto flutuante não decidir um limite.
- **Desempate** nos rankings: por nome em ordem alfabética do português ("Água" junto do A) e depois pelo id.

## Como conferir

- Unitários: `npm test -- src/metricas src/lib/datas`.
- Regressão contra o gabarito (#41): `npm run test:e2e -- tests/metricas-gabarito`. Carrega o seed, roda as métricas pelo serviço e compara produto a produto com `fixtures/gabarito/metricas.json`, que é calculado à parte por `scripts/fixtures/gabarito.ts`. O mesmo teste confere que os parâmetros padrão são os do gabarito e que um lojista não enxerga o produto do outro. O gabarito chama de `n_registros` as unidades vendidas (aqui, `unidades_vendidas`); o desempate dele é pelo id do fixture, que o banco não tem, então os rankings são comparados por grupos de empatados.

## Pendente

Espaço para subir preço (#36), ticket médio (#38), gasto fora do padrão (#39) e estoque parado (#37). As ferramentas do agente que chamam este serviço são #50 a #52.
