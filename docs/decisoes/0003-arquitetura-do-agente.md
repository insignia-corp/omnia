# 0003 · Arquitetura do agente: híbrido mínimo

Data: 20/10/2026 · Status: proposta (o desenho híbrido já está implementado; aceite pendente do dono) · Issues: #53, #55, #57, #105 · Detalhes em [especificação dos agentes](../especificacao-agentes.md)

## Contexto

O edital (seção 10) pergunta "por que múltiplos agentes e não um só, quem consolida e onde fica o estado". Avaliamos um pipeline de 5 papéis (Roteador, Extrator, três especialistas, Consolidador e Redator) contra um agente único. A análise foi feita com o claude-opus-5-5, a partir do código, do gabarito e do edital. As estimativas de custo e latência abaixo vêm de hipóteses declaradas e devem ser trocadas pelo que o registro de execução gravar no `npm run eval` (#74).

## Decisão

Dois agentes ligados por código:

1. **Extrator** (visão, sem ferramentas, saída validada por Zod): foto da nota para JSON. Roda como job de ingestão, fora do loop do agente.
2. **Analista** (o loop atual de `AgenteService`, com todas as ferramentas): escolhe os alertas, responde perguntas e redige a mensagem. Passa pelo verificador de números.

O orquestrador é código (BullMQ, tabelas no PostgreSQL), não um agente. O ranking por impacto em reais é função determinística no motor de alertas (#43, #44). O "sim" do dono é resolvido em código, sem Roteador.

Caminho de evolução: especialistas como ferramentas do Analista (variação "b" abaixo), só depois de o ciclo P0 passar no eval.

## Opções

| Opção | Custo por lojista por mês | Latência de uma pergunta | Esforço extra | Risco de prazo |
| --- | --- | --- | --- | --- |
| Pipeline de 5 papéis | cerca de US$ 6,2 | 45 a 90 s | 4,5 a 6 dias-pessoa | Alto |
| **Híbrido mínimo, Sonnet** | **cerca de US$ 2,1** | **10 a 20 s** | **0,5 a 1** | **Baixo** |
| Híbrido mínimo, Opus | cerca de US$ 4,1 | 15 a 30 s | 0,5 a 1 | Baixo |
| Único com especialistas como ferramentas (b) | cerca de US$ 3,3 | 25 a 50 s | 1,5 a 2 | Médio |

O custo não decide: a diferença é de US$ 2 a 4 por lojista por mês. Decidem o prazo e a latência.

## Por que não o pipeline de 5 papéis

- **Prazo.** Faltam 4 dias e o schema, a ingestão, as métricas, as ferramentas e o eval ainda não existem. O pipeline consumiria de 40% a 60% do tempo de código que sobra, contra o ciclo P0 (nota, alerta, verificador).
- **O problema cruza temas.** No gabarito o arroz aparece em reajuste e em margem; a cerveja, em giro, margem e espaço para subir preço. Separar por tema cria o conflito que o Consolidador teria de resolver.
- **O Consolidador feriria a regra 1 ou seria trivial.** Priorizar por impacto em reais é conta e vai para o código. Sobra escolher 3 entre candidatos já ranqueados.
- **A separação de privilégios rende pouco.** Na conversa o especialista precisa ver a pergunta do dono. As defesas que funcionam nas duas opções já existem: ferramentas só de leitura, `CHAVES_PROIBIDAS`, delimitadores de dado e verificador.
- **Latência.** O pipeline tem 4 estágios em série e 6 ou mais chamadas por pergunta; o híbrido faz 2 ou 3.

## O que o pipeline faria melhor

Encaixa visualmente nas linhas de orquestração e multiagentes do edital; reduz contexto e ferramentas por especialista quando o catálogo passar de 15 a 20 ferramentas; paraleliza o relatório diário (que é lote); permite eval por etapa e divisão de trabalho na equipe.

## Contrapontos aceitos

| Contraponto | Mitigação |
| --- | --- |
| A banca pode ler "chatbot com ferramentas" | Esta decisão e os números do eval no pitch; slide com 2 agentes de privilégios diferentes; tela de bastidores mostrando a escolha dos 3 alertas com justificativa |
| Prompt único cresce e a escolha de ferramenta piora | Teto de cerca de 12 ferramentas; perguntas no eval (#17) que medem a ferramenta escolhida |
| Uma decisão do modelo é ponto único de falha | Ranking em código, verificador e fallback sem números |
| O Analista vê o texto do dono e descrições vindas do banco | Ferramentas só de leitura; escrita só por confirmação executada pelo código; caso de injeção da nota 12 no eval (#73) |
| Opus com pensamento `medium` pesa em custo e latência | Sonnet como padrão; esforço `low` na conversa; Opus só se o eval provar ganho |
| Menos autonomia visível | `ask_owner` no item de baixa confiança e a ação de preço-meta com "sim" |

## Quando reabrir a decisão

- Evoluir para especialistas como ferramentas se, até quinta 22/10 às 18h, o ciclo nota, alerta e verificador não rodar sem intervenção com 100% de números corretos; ou se o agente errar a ferramenta em mais de 10% das perguntas; ou se o catálogo passar de cerca de 15 ferramentas.
- Usar o pipeline só no relatório diário se o Analista deixar o reajuste do arroz fora do top 3 em mais de 20% das rodadas e a versão especializada corrigir isso no mesmo eval.
- Na conversa, não usar pipeline enquanto a latência medida (#74) passar de cerca de 20 s.
- Portão: se na quarta 21/10 às 23h o schema, o seed (#19, #21) e as métricas de margem e variação não estiverem na `develop`, a arquitetura congela no híbrido com 4 ferramentas.

## Consequências

- O núcleo atual (loop, verificador, registro, testes) é reaproveitado sem mudar de forma.
- Pontos a tratar no código estão listados em "Mudanças necessárias" da especificação.
- Um limite conhecido vale para qualquer opção: o verificador confere presença do número, não a quem ele pertence. Um número do produto A atribuído ao produto B passa. A evolução com especialistas aumenta esse risco e exige conferência por vínculo.
