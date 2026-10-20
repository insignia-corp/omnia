# ESTADO: você está aqui

Fonte única do estado atual. Atualizado por `/checkpoint`. Só números datados e com o comando que os gerou; método e decisões moram nos docs-dono (ver [README](README.md)).

Atualizado em: 2026-10-20 · commit base: `40bad35` (develop)

## Etapa

- Etapa 0 (base): feita. Núcleo do agente, verificador de números, CNPJ, dinheiro, esquema de extração, registro de ferramentas e interface `MessageChannel` existem em `src/`.
- Etapa 1 (dados de teste e gabarito): feita (#119). Detalhe em `fixtures/README.md`.
- Modelo de dados completo (schema Drizzle, histórico append-only) e seed dos fixtures (#120): feito. Detalhe em `docs/modelo-de-dados.md`; `npm run seed:demo` existe.
- Próxima: ingestão (Etapa 2) e o menor ciclo ponta a ponta. Fila atual: `gh issue list --label prioridade:P0 --state open`.
- `src/metricas`, `src/alertas`, `src/canal` e `src/avaliacao` ainda são casca (só tipos ou README).

## Números vigentes

| O quê | Valor | Gerado por | Em |
| --- | --- | --- | --- |
| Testes unitários | 99 passam em 9 suítes | `npm test` | 2026-10-20 |
| Lint | 0 erros | `npm run lint` | 2026-10-20 |
| Typecheck | 0 erros | `npm run typecheck` | 2026-10-20 |
| Eval | ainda não existe (`npm run eval`, #68 a #74) | n/a | n/a |

## Pendências

- `test:e2e` não foi rodado nesta sessão (exige PostgreSQL e Redis no ar).
- Decisão 0003 (arquitetura do agente) está como proposta; custo e latência são estimativas até o `npm run eval` medir (#74).
- Modelo padrão em `src/config/env.ts` ainda é `claude-opus-5-5` (decisão 0002), troca para Sonnet depende do eval.

## Linha do tempo

- 2026-10-19: Etapa 0 e núcleo do agente.
- 2026-10-20: modelo de dados e seed (#120). Etapa 1 integrada (#119), AGENTS.md (#117), especificação dos agentes, ecossistema de contexto (AGENTS.md como dono das regras e do roteamento, CLAUDE.md importa AGENTS.md, ESTADO, protocolos em docs/protocolos).
- 2026-10-24 15h30: congelamento do código.
