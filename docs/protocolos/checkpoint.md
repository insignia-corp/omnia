# Protocolo: checkpoint (pós-análise)

Para qualquer agente, ao fechar uma sessão. Objetivo: a próxima sessão começa só lendo `docs/ESTADO.md`, sem reler a conversa.

1. **O que aconteceu**: `git status -sb` e `git diff --stat`. Resuma em 3 linhas o que mudou.
2. **Números para o ESTADO**: rode só o que a sessão tocou (`npm test`, `npm run lint`, `npm run typecheck`, `npm run eval` e `eval:extracao`, se a sessão os tocou). Salve a saída bruta em `evidencias/AAAA-MM-DD-<comando>.txt` (o `npm run eval` já grava o JSON bruto em `evidencias/AAAA-MM-DD-eval-<modo>-<hora>.json`) e destile para a tabela "Números vigentes" de `docs/ESTADO.md`: valor, comando e data. Substitua a linha antiga, não acrescente outra.
3. **Etapa e próxima ação**: atualize "Etapa", "Pendências" e a linha do tempo (uma linha por sessão relevante). Confirme issues com `gh issue list` antes de citar número.
4. **Lição para o dono**: decisão, método ou pegadinha de dados vai para o dono do tema (ver `docs/README.md`): decisão em `docs/decisoes/NNNN-*.md`, método no guia, pegadinha em `fixtures/README.md`. No ESTADO fica só o ponteiro.
5. **Commit**: se estiver em `develop` ou `main`, crie antes `feature/<issue>-<slug>`. Commit pequeno com prefixo `docs`, `feat`, `fix`, `test` ou `chore`. Sem push a menos que o usuário peça.
6. **Resposta**: no máximo 5 linhas (feito, números, pendência, próxima ação, hash do commit).

Regras: sem travessões; nada de segredo em `evidencias/`; não invente número que não saiu de um comando rodado agora.
