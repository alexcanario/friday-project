# Token do autor

O token do autor (`author_token_env`) é usado pelo daemon para abrir PRs e ler o estado do CI. A leitura do CI chama `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` (check-runs), e essa API **não aceita token fine-grained**: a permissão `Checks` não existe para esse tipo de token. Com ele, a API responde 403 com "Resource not accessible by personal access token".

## O que usar

- **GitHub App** (caminho adotado): o App `friday-author` gera um token de instalação com a permissão `Checks`. A entrega do token ao daemon foi decidida na D89 (opção A) e é implementada na #363.
- Um **token clássico** com escopo `repo`: serve como saída provisória, mas tem escopo amplo e vida longa.
- **Não serve:** token fine-grained.

## Sintoma

O daemon registra, a cada tick, a mensagem em pt-BR do `getCiStatus` que nomeia a causa e a saída. O status original (403) fica em `error.cause.status`.

## Siglas
- **API:** interface de programação.
- **CI:** integração contínua.
- **D89:** decisão 89 de `docs/decisions.md`.
- **PR:** pull request.
