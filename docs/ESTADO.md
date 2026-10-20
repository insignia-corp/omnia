# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-20 · commit base: `fce168a` · branch `feature/28-planilha-vendas` (PR 124, com a `develop` e os PRs 122 e 123 já mesclados)

## Etapa

- Etapa 0 (base): feita. Núcleo do agente, verificador de números, CNPJ, dinheiro, esquema de extração, registro de ferramentas e interface `MessageChannel` existem em `src/`.
- Etapa 1 (dados de teste e gabarito): feita (#119). Detalhe em `fixtures/README.md`.
- Modelo de dados completo (schema Drizzle, histórico append-only) e seed dos fixtures (#120): feito. Detalhe em `docs/modelo-de-dados.md`; `npm run seed:demo` existe.
- Etapa 2 (ingestão), em andamento. Na `develop` (PR 122): armazenamento (#22), upload e fila BullMQ (#23), Extrator com Zod (#24), validações em código (#25). Em `develop` (PR 123): revisão de item e pergunta ao dono (#26), vínculo item-produto por catálogo e similaridade (#27, sem a sugestão do modelo). No PR 124 (aberto, revisão do Codex corrigida): importação de planilha de vendas CSV e XLSX (#28) e pergunta `confirmar_documento` para a nota em dúvida. Falta: sugestão de vínculo pelo modelo (#27) e NF-e (#29, P2). Detalhe em `src/ingestao/README.md`.
- Próxima: mesclar o PR 124 e exercitar o Extrator com chave real. Fila atual: `gh issue list --label prioridade:P0 --state open`.
- `src/metricas`, `src/alertas`, `src/canal` e `src/avaliacao` ainda são casca (só tipos ou README).

## Números vigentes

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 262 passam em 23 suítes | `npm test` (Node 24) | 2026-10-20 |
| Testes e2e | 52 passam em 7 suítes (PostgreSQL e Redis reais, cliente de visão falso) | `npm run test:e2e` (Node 24) | 2026-10-20 |
| Lint | 0 erros | `npm run lint` | 2026-10-20 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-20 |
| Vínculo nota-produto sem perguntar | 97,9% (92 de 94 itens das 18 notas), 0 ligações erradas | `npm run test:e2e -- tests/vinculo` | 2026-10-20 |
| Eval | ainda não existe (`npm run eval`, #68 a #74) | n/a | n/a |

## Pendências

- Os e2e novos do PR 124 (planilha e pergunta de documento) ainda não rodaram com banco e Redis reais; conferir na CI antes de atualizar a linha de e2e acima.
- A exclusão em cascata de um comerciante com a planilha da demo importada (cerca de 15 mil linhas) leva cerca de 6 s; considerar ao implementar a exclusão LGPD (#85).
- Ambiente: `npm test` e `npm run test:e2e` exigem Node 24 (a CI usa 24); no Node 22 as suítes que carregam o Nest não rodam. Banco que já aplicou a migração com a numeração antiga (`0004_ingestao`) precisa ser recriado (`npm run db:reset`).
- A chamada real ao modelo com visão (imagem e saída estruturada em `cliente-visao-anthropic.ts`) não foi exercida: sem `ANTHROPIC_API_KEY` no ambiente. Os testes usam cliente falso. Primeiro uso com chave: enviar 3 fotos de `fixtures/notas/` e conferir `execucao_agente`.
- Aviso ao dono quando a extração falha depende do canal (#106, #66); hoje o estado fica em `documento.status` e `documento.erro`.
- Identidade do comerciante nas rotas HTTP é o cabeçalho `X-Comerciante-Id` conferido no banco (`src/comerciante/sessao.ts`), provisório até o canal autenticar.
- Decisão 0003 (arquitetura do agente) está como proposta; custo e latência são estimativas até o `npm run eval` medir (#74).
- Modelo padrão em `src/config/env.ts` ainda é `claude-opus-5-5` (decisão 0002), troca para Sonnet depende do eval.

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120). Etapa 1 integrada (#119), AGENTS.md (#117), especificação dos agentes, ecossistema de contexto (AGENTS.md como dono das regras e do roteamento, CLAUDE.md importa AGENTS.md, ESTADO, protocolos em docs/protocolos).
- 2026-10-20: Etapa 2, PR 1: armazenamento, upload com fila BullMQ, Extrator, validações em código e migração `0005_ingestao` (`historico_custo` aceita correção do dono como linha nova).
- 2026-10-20: Etapa 2, PR 2: perguntas ao dono por item duvidoso e por vínculo, resposta que entra como linha nova no histórico, recálculo do documento e vínculo por similaridade.
- 2026-10-20: revisão do Codex no PR 123 corrigida (data inexistente, CNPJ ilegível, confiança da resposta do dono, quantidade com 3 casas, `revisao` só com pergunta pendente, auditoria da extração antes da gravação). Detalhe em `src/ingestao/README.md`.
- 2026-10-20: Etapa 2, PR 3: importação de planilha de vendas CSV e XLSX com mapeamento confirmado uma vez, idempotente por cupom, conferida contra o gabarito. Revisão do Codex no PR 124 corrigida (cupom sintético por arquivo, retentativa após falha, leitura antes de guardar, nome ambíguo, quantidade com 3 casas, `exceljs` em dependências, pergunta de documento). Detalhe em `src/ingestao/README.md`.
- 2026-10-24 15h30: congelamento do código.
