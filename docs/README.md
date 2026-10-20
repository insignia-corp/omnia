# Documentação

Índice e mapa de donos. Regra: cada fato vive em um único arquivo (o dono). Os demais apontam para ele.

| Tema | Dono | Camada |
| --- | --- | --- |
| Etapa atual, números vigentes, próxima ação, pendências | [ESTADO.md](ESTADO.md) | Estado |
| Etapas, modelo de dados, métricas, agente, avaliação, LGPD | [guia-desenvolvimento.md](guia-desenvolvimento.md) | Metodologia |
| Prazo, escopo cortado, o que a banca avalia no código | [alertas-hackathon.md](alertas-hackathon.md) (prevalece sobre o guia) | Metodologia |
| Tabelas, colunas, histórico append-only | [modelo-de-dados.md](modelo-de-dados.md) | Documentação |
| Agentes: papéis, ferramentas, prompt, custo estimado | [especificacao-agentes.md](especificacao-agentes.md) | Documentação |
| Fluxo do agente (inputs, lógica, outputs) | [agent-flow.md](agent-flow.md) | Documentação |
| Módulos, serviços e dados | [arquitetura.md](arquitetura.md) | Documentação |
| Decisões numeradas e suas fontes | [decisoes/](decisoes/) | Pesquisa |
| Critérios da banca, persona, viabilidade, riscos | [contexto-hackathon.md](contexto-hackathon.md) | Pesquisa |
| Dados de teste, gabarito, convenções | [../fixtures/README.md](../fixtures/README.md) | Dados |
| Saídas brutas de eval, testes e medições | [../evidencias/](../evidencias/) | Evidências |
| Regras invioláveis, roteamento, convenções e fluxo de trabalho de qualquer agente | [../AGENTS.md](../AGENTS.md) | Sempre carregado |
| Procedimentos de fechar sessão e auditar edição | [protocolos/](protocolos/) | Metodologia |
| Divisão em 3 planos, issues de cada um, regras de colisão | [protocolos/divisao-planos.md](protocolos/divisao-planos.md) | Metodologia |

## Fluxo do conhecimento

1. Saída bruta (eval, teste, medição) vai para `evidencias/`.
2. Os números que importam são destilados para `ESTADO.md`, com data e comando que os gerou.
3. Uma lição que vale além da sessão (decisão, método, pegadinha dos dados) vai para o dono do tema: nova decisão em `decisoes/NNNN-*.md`, método no guia, pegadinha em `fixtures/README.md`.
4. [protocolos/checkpoint.md](protocolos/checkpoint.md) faz os passos 2 e 3 ao fim da sessão; [protocolos/auditoria.md](protocolos/auditoria.md) confere depois de editar. No Claude Code, `/checkpoint` e `/auditoria` são atalhos para eles.
