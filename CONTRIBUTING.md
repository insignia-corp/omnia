# Como contribuir

Leia antes o [CLAUDE.md](CLAUDE.md) (regras invioláveis) e o [guia de desenvolvimento](docs/guia-desenvolvimento.md).

## Organização do trabalho

- **Milestones**: uma por etapa do roteiro (Etapa 0 a 8), mais as trilhas transversais. Só avance de etapa quando o critério de pronto da milestone passar.
- **Épicos**: uma issue `tipo:épico` por milestone. As tarefas são sub-issues do épico.
- **Project**: o quadro com Status, Prioridade, Tamanho e Etapa. Mova o card ao começar e ao abrir a PR.

### Labels

| Grupo | Labels | Uso |
| --- | --- | --- |
| Tipo | `tipo:épico`, `tipo:feature`, `tipo:tarefa`, `tipo:bug`, `tipo:teste`, `tipo:docs`, `tipo:pesquisa` | Exatamente um por issue |
| Área | `área:infra`, `área:dados`, `área:ingestão`, `área:métricas`, `área:alertas`, `área:agente`, `área:canal`, `área:avaliação`, `área:segurança`, `área:demo`, `área:validação`, `área:negócio`, `área:pitch` | Uma ou mais |
| Prioridade | `prioridade:P0`, `prioridade:P1`, `prioridade:P2` | P0 sustenta a demo e o critério de uso de IA; P2 corta primeiro |
| Outros | `usa-llm`, `regra-inviolável`, `plano-b`, `bloqueado` | Quando se aplicar |

PRs em issues com `regra-inviolável` precisam de teste que prove a regra.

## Fluxo de branches

1. Atualize a `develop`: `git checkout develop && git pull`
2. Crie uma branch com o número da issue: `git checkout -b feature/12-upload-de-nota`
3. Faça commits pequenos e descritivos (ex.: `feat: adiciona upload de nota`)
4. Envie: `git push -u origin feature/12-upload-de-nota`
5. Abra um Pull Request para `develop` com `Closes #12` na descrição e peça revisão de pelo menos 1 pessoa
6. Releases: PR de `develop` para `main` ao fim de cada etapa

## Antes de abrir a PR

```bash
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

A CI roda os mesmos passos, mais a varredura de segredos e o build da imagem.

## Prefixos de commit

`feat`, `fix`, `docs`, `refactor`, `test`, `chore`

## Convenções de código

- Dinheiro sempre em centavos como inteiro. Nunca ponto flutuante.
- Toda consulta com dado do lojista filtra por `comerciante_id`, que vem da sessão.
- Nomes de domínio em português (`comerciante`, `item_de_compra`); ferramentas do agente em inglês (`get_product_margin`).
- Métricas são funções puras com teste unitário.
- Não usar travessões em textos e mensagens.
