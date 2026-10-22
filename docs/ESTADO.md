# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-22 · commit base: `4aaa5db` (`develop` após o PR 181) · branch `feature/182-whatsapp-integrado`

## Etapa

- Etapa 0 (base): feita. A CI também confere variáveis de ambiente contra `.env.example`, deriva das migrações e `comerciante_id` em toda tabela (guardas no `.github/workflows/ci.yml`, PR 152). Id de correlação entre requisição e jobs nos logs (#10). Resta ligar a CI como status obrigatório na proteção das branches (#7).
- Etapa 1 (dados de teste e gabarito): feita. Falta só a revisão do gabarito de métricas por uma segunda pessoa (#16). Detalhe em `fixtures/README.md`.
- Etapa 2 (ingestão): na `develop`, armazenamento, upload e fila BullMQ, Extrator com Zod, validações em código, revisão de item e pergunta ao dono, vínculo por catálogo, similaridade, código de barras e sugestão do modelo confirmada pelo dono (#27), planilha de vendas CSV e XLSX (#28) e NF-e em XML (#29). Falta a integração Pluggy em sandbox (#30, P2, adiada: só entra se sobrar tempo; o que está fora do escopo é o Open Finance real). A resolução de importação parcial de planilha entrou no PR 187 (#142, fechada). Detalhe em `src/ingestao/README.md`.
- Etapa 3 (métricas): feita, com o épico #31 fechado. Resumo da semana e do mês e o preço que leva a margem à meta entram com o #182. Margem, variação de custo, giro, resumo diário, ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço batem com o gabarito, e o conjunto de alertas esperados também (#41). Débitos em #143 (extrato por conta), #144 (propagar origem e confiança do produto) e #148 (critério de receita). Detalhe em `src/metricas/README.md`.
- Etapa 4 (motor de alertas): o motor de regras com prioridade e supressão está na `develop` (#43 e #44, fechadas; PR 153). Job de reajuste e teste de detecção (#45, #46), `list_alert_candidates` (#52), status `enviado` e `descartado` (#155) e candidato velho (#157) fechados. Limites por comerciante (#147, PR 188) mesclados. Aberta: #172 (a exceção da regra 7 para o motor já está documentada no PR 189).
- Etapa 5 (agente): na `develop`, núcleo, verificador, registro de execuções, loop diário e modo conversa (#55, fechada), `ask_owner`, `save_owner_answer`, `propose_target_price` e `select_alerts` (o envio não é ferramenta: o `AgenteService` devolve o texto verificado e o `MessageChannel` entrega), ação com confirmação do dono e preço-meta (#104), as ferramentas de leitura `get_daily_summary`, `get_top_products`, `get_product_margin` e `get_cost_changes` (#50, #51, #149 e #156, fechadas; PRs 145, 160 e 168). `list_alert_candidates` (#52) e `get_period_summary` (#182) também. Critério `receita` em `get_top_products` e receita por produto (#148, fechada; PR 169).
- Etapa 6 (canal): na `develop`, `MessageChannel`, chat web como plano B, escolha por `CANAL`, job do relatório diário com chave de idempotência e horário de silêncio (#64, #66, #106). WhatsApp simulado para o pitch (#179, PR 181, mesclado) ligado ao backend e ao banco (#182, este PR): `/whatsapp` servido pelo Nest, status e digitando do banco, botões e lista escolhidos em código, modelo `resumo_diario` fora da janela de 24 h, nota lida na conversa e `/painel`. Detalhe em `src/canal/README.md`. A Cloud API real (#61 a #63) e áudio (#107) não começaram.
- Etapa 7 (avaliação): o harness `npm run eval` existe (#68) e a rodada com modelo falso tem 50 casos: perguntas numéricas, casos do verificador, perguntas sem resposta e injeção de instrução (#69, #70, #72 e #73, fechadas). A avaliação da extração de notas tem runner próprio, `npm run eval:extracao` (#71, fechada); custo e tempo por execução em `npm run eval:custo` (#74, fechada).
- Etapa 8 (demo): dataset fixo com reset em um comando (#76) e tela de bastidores (#77) na `develop`. Faltam roteiro, gravação e checklist de congelamento (#78, #79, #111).
- Próxima ação: mesclar este PR (#182) e ensaiar o roteiro do pitch em `/whatsapp` com `npm run seed:demo` e `DEMO_DATA_REFERENCIA=2026-10-20`; roteiro, gravação e checklist de congelamento (#78, #79, #111). Fila atual: `gh issue list --label prioridade:P0 --state open`.

## Números vigentes

Gerados em 2026-10-22 sobre `feature/182-whatsapp-integrado` (a `develop` em `4aaa5db` mais o #182), com Node 24, PostgreSQL 18 e Redis 8 locais. Saídas brutas em `evidencias/2026-10-22-*.txt`. Eval e vínculo não foram rodados de novo nesta sessão.

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 1269 passam em 88 suítes | `npm test` (Node 24) | 2026-10-22 |
| Testes e2e | 555 passam em 40 suítes (PostgreSQL e Redis reais, cliente de visão e modelo falsos) | `npm run test:e2e` (Node 24) | 2026-10-22 |
| Testes do front do WhatsApp | 25 passam | `npm run test:web` | 2026-10-22 |
| Lint | 0 erros | `npm run lint` | 2026-10-22 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-22 |
| Build | passa | `npm run build` | 2026-10-22 |
| Eval (modelo falso, prompt `sistema-v2`) | 50 de 50 casos passam (numéricas, verificador, sem resposta e injeção); relatório em `docs/avaliacoes/2026-10-21-sistema-v2-falso.md` | `npm run seed:demo` e `npm run eval` | 2026-10-21 |
| Vínculo nota-produto sem perguntar | 97,9% (92 de 94 itens das 18 notas), 0 ligações erradas. O e2e `tests/vinculo-notas` (94 itens, 0 ligações erradas, pelo menos 90% sem perguntar) faz parte dos 555 e reconfirmou essas condições em 2026-10-22; só o 97,9% exato não foi medido de novo | `npm run test:e2e -- tests/vinculo` | 2026-10-20 |

## Em PR aberto

- Este PR: WhatsApp simulado ligado ao backend e ao banco (#182).

## Pendências

- Eval com modelo real ainda não rodou (`npm run eval -- --modelo real` exige `ANTHROPIC_API_KEY`); custo e latência da decisão 0003 seguem estimativas até lá, e o modelo padrão já é `claude-sonnet-5-5` (decisão 0002, trocado em 21/10/2026); o eval diz se o Opus compensa.
- A chamada real ao modelo com visão foi exercida uma vez em 2026-10-22, pelo `/whatsapp` (uma cópia de `fixtures/notas/nota-07.jpg` lida, com a soma dos itens fechando com o total); falta medir 3 fotos em `execucao_agente`.
- No pitch, foto de `fixtures/notas/` reenviada não é extraída de novo (já está no seed): ver `fixtures/README.md`, "Carga no banco".
- As ferramentas do agente usam a data de referência (hoje); com `DEMO_DATA_REFERENCIA=2026-10-20` não há vendas de hoje, então rankings de 7 dias (`get_top_products`) e avisos falam em dado ausente de hoje. Os botões do `/whatsapp` pedem "até ontem" e o "Sugerir preço" já recebe o produto escolhido em código (#182).
- Higiene de documentação (`send_message`, status de PRs, label do Pluggy) em #159.
- O extrato de uma conta vale até a última transação importada (a cobertura por conta e a origem do produto nas métricas entraram no PR 170, #143 e #144 fechadas): uma conta ativa parada ou sem transação deixa o dia sem total de gastos até haver data da última sincronização (#166).
- A exclusão em cascata de um comerciante com a planilha da demo importada (cerca de 15 mil linhas) leva cerca de 6 s; considerar ao implementar a exclusão LGPD (#85).
- Ambiente: `npm test` e `npm run test:e2e` exigem Node 24 (a CI usa 24); no Node 22 as suítes que carregam o Nest não rodam. Banco que já aplicou a migração com a numeração antiga (`0004_ingestao`) precisa ser recriado (`npm run db:reset`).
- Identidade do comerciante nas rotas HTTP é o cabeçalho `X-Comerciante-Id` conferido no banco (`src/comerciante/sessao.ts`), provisório até o canal autenticar. O `/whatsapp` e o link do `/painel` levam o id na URL (`?comerciante=`), também provisório.
- Banco local que aplicou a migração `0009_mensagem_whatsapp` de uma versão anterior deste branch precisa ser recriado (`npm run seed:demo`): ela virou `0012` depois da `develop`.
- Nem `develop` nem `main` têm proteção de branch com a CI como status obrigatório (#7). A CI da `develop` falhou em `0739059` e `35cd3e5`; a formatação de `src/lib/verificador-numeros`, que o `prettier --check` acusava, foi corrigida em `5689b27`.
- Decisão 0003 (arquitetura do agente) está como proposta.

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120), Etapa 1 integrada (#119), AGENTS.md, especificação dos agentes e ecossistema de contexto.
- 2026-10-20: Etapa 2, PRs 122 a 124: armazenamento, upload com fila, Extrator, validações, perguntas ao dono, vínculo e planilha de vendas. Detalhe em `src/ingestao/README.md`.
- 2026-10-20: divisão técnica em 3 planos (PR 128). Ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço (PR 127).
- 2026-10-21: Etapa 3 completa (PRs 126 e 146): métricas, correções do Codex e regressão contra o gabarito. Canal com chat web (PR 129), registro de execuções e retentativas (PR 131), `ask_owner` e `save_owner_answer` (PR 132), loop diário e modo conversa (PR 133), reset da demo e bastidores (PR 134), NF-e em XML (PR 136), vínculo por código de barras e sugestão do modelo (PR 137), harness de avaliação (PR 138), ação com confirmação do dono (PR 141). Também mesclados: ponto de encaixe do catálogo e módulos vazios (PR 130), documentação do fluxo do agente (PR 135), ajuste do e2e de revisão de notas (PR 140) e correção do verificador para ignorar ids (PR 150). No fim do dia: ferramentas de leitura do agente (PRs 145 e 160), guardas de CI com a renumeração da migração `0012` para `0007` (PR 152), sobras da revisão do PR 134 (PR 154) e os casos de avaliação numéricos, do verificador e sem resposta (commit `151a03b`).
- 2026-10-21 (noite): motor de regras de alertas com prioridade e supressão (PR 153), avaliação de injeção de instrução (PR 161) e da extração de notas (PR 162), `get_product_margin` com apelidos confirmados e produtos de mesmo nome (PR 168), e este checkpoint (PR 151, versão anterior). Issues novas: #166 (extrato por data de sincronização) e #167 (descrição de nota em `get_product_margin`).
- 2026-10-21 (madrugada de 22): cobertura de extrato por conta e origem e confiança do produto nas métricas (PR 170).
- 2026-10-22: alertas fechados de ponta a ponta (#45, #46, #52, #155, #157), extrato por sincronização (#166), menor confiança nos candidatos (#172) e demo ponta a ponta com o motor real (PR 180). WhatsApp simulado (#179) e integrado ao backend e ao banco com resumo da semana e do mês, painel e modelo fora da janela (#182).
- 2026-10-24 15h30: congelamento do código.
