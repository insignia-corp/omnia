# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-21 · commit base: `358d386` (`develop` após o PR 146) · branch `docs/estado-checkpoint`

## Etapa

- Etapa 0 (base): feita. Resta ligar a CI como status obrigatório na proteção das branches (#7) e o id de correlação por job (#10).
- Etapa 1 (dados de teste e gabarito): feita. Falta só a revisão do gabarito de métricas por uma segunda pessoa (#16). Detalhe em `fixtures/README.md`.
- Etapa 2 (ingestão): na `develop`, armazenamento, upload e fila BullMQ, Extrator com Zod, validações em código, revisão de item e pergunta ao dono, vínculo por catálogo, similaridade, código de barras e sugestão do modelo confirmada pelo dono (#27), planilha de vendas CSV e XLSX (#28) e NF-e em XML (#29). Falta a integração Pluggy (#30, P2, fora do escopo regional), o fluxo de resolução de importação parcial de planilha (#142) e a propagação de origem e confiança do produto (#144). Detalhe em `src/ingestao/README.md`.
- Etapa 3 (métricas): feita. Margem, variação de custo, giro, resumo diário, ticket médio, gasto fora do padrão, estoque parado e espaço para subir preço batem com o gabarito, e o conjunto de alertas esperados também (#41). Débitos em #143 (extrato por conta) e #148 (critério de receita). Detalhe em `src/metricas/README.md`.
- Etapa 4 (motor de alertas): não começou na `develop`; `src/alertas` é casca. Em andamento por outra frente: #43, #44, depois #45 e #46.
- Etapa 5 (agente): na `develop`, núcleo, verificador, registro de execuções, loop diário e modo conversa (#55), `ask_owner`, `save_owner_answer`, `send_message`, ação com confirmação do dono e preço-meta (#104). Aberto em PR 145: `get_daily_summary`, `get_top_products`, `get_product_margin` e `get_cost_changes` (#50, #51). Falta `list_alert_candidates` (#52, depende do motor de alertas).
- Etapa 6 (canal): na `develop`, `MessageChannel`, chat web como plano B, escolha por `CANAL`, relatório diário idempotente com horário de silêncio (#64, #66, #106). WhatsApp (#59 a #63) e áudio (#107) não começaram.
- Etapa 7 (avaliação): o harness `npm run eval` existe (#68), com 2 casos de exemplo (q01 e q33). Faltam os casos de #69 a #74.
- Etapa 8 (demo): dataset fixo com reset em um comando (#76) e tela de bastidores (#77) na `develop`. Faltam roteiro, gravação e checklist de congelamento (#78, #79, #111).
- Próxima ação: fechar o motor de alertas (#43 e #44) para liberar `list_alert_candidates` (#52) e o job de reajuste (#45, #46); mesclar o PR 145; depois os casos de avaliação (#69 a #74). Fila atual: `gh issue list --label prioridade:P0 --state open`.

## Números vigentes

Gerados em 2026-10-21 sobre a `develop` em `358d386`, com Node 24 (via `npx`), PostgreSQL 18 e Redis 8 descartáveis.

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 730 passam em 57 suítes | `npm test` (Node 24) | 2026-10-21 |
| Testes e2e | 379 passam em 24 suítes (PostgreSQL e Redis reais, cliente de visão e modelo falsos) | `npm run test:e2e` (Node 24) | 2026-10-21 |
| Lint | 0 erros | `npm run lint` | 2026-10-21 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-21 |
| Build | passa | `npm run build` | 2026-10-21 |
| Eval (modelo falso) | 2 de 2 casos passam (q01 e q33, só exemplos) | `npm run seed:demo` e `npm run eval` | 2026-10-21 |
| Vínculo nota-produto sem perguntar | 97,9% (92 de 94 itens das 18 notas), 0 ligações erradas; não reexecutado depois do vínculo por código de barras (#137) | `npm run test:e2e -- tests/vinculo` | 2026-10-20 |

## Em PR aberto

- PR 145: ferramentas de leitura do agente (#50, #51), sem conflito com a `develop` na data.
- PR 139: corrige o e2e "o dono confirma a nota"; a `develop` já tem a correção do PR 140, então ele conflita e está superado (decisão do dono).
- O motor de alertas (#43, #44) e a correção do verificador estão em andamento e sem PR aberto na data.

## Pendências

- Eval com modelo real ainda não rodou (`npm run eval -- --modelo real` exige `ANTHROPIC_API_KEY`); custo e latência da decisão 0003 seguem estimativas até lá, e a troca do modelo padrão `claude-opus-5-5` por Sonnet (decisão 0002) depende dele.
- A chamada real ao modelo com visão (`cliente-visao-anthropic.ts`) não foi exercida: sem chave no ambiente. Primeiro uso: enviar 3 fotos de `fixtures/notas/` e conferir `execucao_agente`.
- Planilha importada com linha rejeitada fica em `revisao` e as vendas dela entram nas métricas com confiança 0,5 sem caminho para voltar (#142).
- O intervalo de extrato é um só para todas as contas; com duas contas, o gasto pode sair subestimado (#143).
- A exclusão em cascata de um comerciante com a planilha da demo importada (cerca de 15 mil linhas) leva cerca de 6 s; considerar ao implementar a exclusão LGPD (#85).
- Ambiente: `npm test` e `npm run test:e2e` exigem Node 24 (a CI usa 24); no Node 22 as suítes que carregam o Nest não rodam. Banco que já aplicou a migração com a numeração antiga (`0004_ingestao`) precisa ser recriado (`npm run db:reset`).
- Identidade do comerciante nas rotas HTTP é o cabeçalho `X-Comerciante-Id` conferido no banco (`src/comerciante/sessao.ts`), provisório até o canal autenticar.
- Nem `develop` nem `main` têm proteção de branch com a CI como status obrigatório (#7).
- Decisão 0003 (arquitetura do agente) está como proposta.

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120), Etapa 1 integrada (#119), AGENTS.md, especificação dos agentes e ecossistema de contexto.
- 2026-10-20: Etapa 2, PRs 122 a 124: armazenamento, upload com fila, Extrator, validações, perguntas ao dono, vínculo e planilha de vendas. Detalhe em `src/ingestao/README.md`.
- 2026-10-20: divisão técnica em 3 planos (PR 128).
- 2026-10-21: Etapa 3 completa (PRs 126, 127, 146): métricas, correções do Codex e regressão contra o gabarito. Canal com chat web (PR 129), registro de execuções e retentativas (PR 131), `ask_owner` e `save_owner_answer` (PR 132), loop diário e modo conversa (PR 133), reset da demo e bastidores (PR 134), NF-e em XML (PR 136), vínculo por código de barras e sugestão do modelo (PR 137), harness de avaliação (PR 138), ação com confirmação do dono (PR 141).
- 2026-10-24 15h30: congelamento do código.
