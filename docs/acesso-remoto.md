# Acesso remoto ao painel

Este documento diz, em um só lugar, o que o proxy ou túnel gerenciado precisa fazer para expor o painel fora da máquina do daemon, quais variáveis o daemon lê, como trocar o token e o que foi avaliado sobre o login por usuário. Decisões de origem: D118 e D119 (`docs/decisions.md`), issue #638.

## Como o painel é exposto

A API do daemon continua presa a `127.0.0.1` (D117, item 4). Quem a expõe é um proxy reverso ou um túnel gerenciado, que dá ao painel um endereço público `https://<endereço público>`, termina o HTTPS e põe uma camada de login na frente. Não há VPN entre os aparelhos (D118, item 1).

Duas camadas protegem o painel:

- o login do proxy ou túnel, que decide quem chega até a API;
- o token do painel, enviado pelo navegador no cabeçalho `x-friday-token`, que a API confere nos pedidos das rotas da API (runs, issues, aprovações, eventos e o `/openapi.json`).

O token não cobre `/health` nem os arquivos estáticos do painel (HTML, JavaScript e CSS): nessas rotas o login do proxy é a única barreira. Por isso o login do proxy é obrigatório, não opcional.

As checagens correm nesta ordem: `Host`, HTTPS, CORS, limite de tentativas e token. Com o limite já atingido, um pedido com `Host` errado ou sem HTTPS ainda recebe `403` (e conta como recusa); os demais recebem `429`.

De fora dá para acompanhar as runs e aprovar ou rejeitar (D118, item 2), em notebook, tablet e celular.

## Variáveis do daemon

| Variável                        | O que faz                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `FRIDAY_PANEL_ORIGINS`          | Lista, separada por vírgula, das origens que podem chamar a API (por exemplo o endereço público do painel). |
| `FRIDAY_PANEL_TOKEN`            | O token que o navegador envia no cabeçalho `x-friday-token`.                               |
| `FRIDAY_PANEL_TOKEN_EXPIRES_AT` | A data e a hora em que o token deixa de valer.                                             |

Regras de cada uma. Se uma regra for violada, o painel não sobe, o log explica em pt-BR o que falta e o daemon continua rodando sem o painel.

- `FRIDAY_PANEL_ORIGINS`: toda origem que não seja `127.0.0.1`, `localhost` ou `[::1]` precisa começar com `https://`. Com origens definidas e `FRIDAY_PANEL_TOKEN` vazia, o painel também não sobe. Os nomes de `Host` aceitos saem destas origens; `127.0.0.1` e `localhost` na porta do painel são sempre aceitos.
- `FRIDAY_PANEL_TOKEN`: só letras e números (`A-Z`, `a-z`, `0-9`) e pelo menos 32 caracteres. A API confere o token só nas rotas da API; `/health` e os arquivos estáticos do painel não o exigem, e nessas rotas o login do proxy é a única barreira.
- `FRIDAY_PANEL_TOKEN_EXPIRES_AT`: data e hora em UTC no formato `AAAA-MM-DDTHH:MM:SSZ`, por exemplo `2026-12-20T00:00:00Z`, no futuro e a no máximo 90 dias. É obrigatória quando alguma origem está fora do loopback (origem pública). Quando está definida, também é conferida em uma instalação só com loopback. Depois da data, a API recusa o token com `401` e a resposta `Token do painel expirado.`. O daemon avisa no log quando faltam 7 dias ou menos.
- HTTPS obrigatório fora do loopback: um pedido cujo `Host` não seja `127.0.0.1`, `localhost` ou `[::1]` só é atendido se o cabeçalho `x-forwarded-proto` for `https`. Senão a API responde `403` com `HTTPS obrigatório.`. As respostas atendidas levam `strict-transport-security`.

### Limite de tentativas

O contador é único e global (D119, item 2): um só para todos os pedidos, de todos os clientes: 10 recusas em 60 s. Cada `401` ou `403` conta como uma recusa. Ao chegar ao limite, a API responde `429` a todos os pedidos, menos `/health`, até a janela terminar; a resposta traz o cabeçalho `retry-after` com os segundos que faltam. Cada recusa e o limite ficam no log, sem o token.

Como o contador vale para todos, qualquer cliente que passe pelo login do proxy, ou uma aba antiga do dono, pode gastar as 10 recusas e bloquear o painel para todos por 60 s. O limite não substitui o login do proxy contra tentativas em massa: o login precisa ter a sua própria proteção.

### Respostas de recusa

| Código | Texto                                                  | Quando                                                   |
| ------ | ------------------------------------------------------ | -------------------------------------------------------- |
| `401`  | `Token do painel inválido.`                            | O `x-friday-token` está ausente ou não confere.          |
| `401`  | `Token do painel expirado.`                            | A data de `FRIDAY_PANEL_TOKEN_EXPIRES_AT` já passou.     |
| `403`  | `Host não permitido.`                                  | O `Host` não é de nenhuma origem aceita.                 |
| `403`  | `Origem não permitida.`                                | O preflight (`OPTIONS`) de uma origem que não está em `FRIDAY_PANEL_ORIGINS`. Um `GET` ou `POST` de origem fora da lista não é recusado por esta checagem (só não recebe `access-control-allow-origin`); quem o barra é o token. A lista não protege contra clientes que não são navegadores. |
| `403`  | `HTTPS obrigatório.`                                   | Fora do loopback sem `x-forwarded-proto: https`.         |
| `429`  | `Muitas tentativas recusadas. Tente de novo em instantes.` | O limite de tentativas foi atingido.                 |

## O que o proxy ou túnel gerenciado precisa fazer

1. Pôr o login na frente: nenhum pedido chega à API sem passar por ele.
2. Terminar o HTTPS. A API não serve TLS; o daemon escuta em `127.0.0.1`.
3. Enviar `x-forwarded-proto: https` em todo pedido repassado. Sem esse cabeçalho a API responde `403` com `HTTPS obrigatório.`. Se o cabeçalho chegar com vários valores separados por vírgula, todos precisam ser `https`.
4. Manter o `Host` público original, sem reescrevê-lo. Se o proxy trocar o `Host` por `127.0.0.1:<porta>` (o padrão do nginx com `proxy_pass`), a API trata o pedido como loopback e pula a checagem de HTTPS. A API nunca lê `X-Forwarded-Host`.
5. Repassar `x-friday-token` e `Origin` sem alterar, senão a API recusa o token ou a origem.
6. Listar `https://<endereço público>` em `FRIDAY_PANEL_ORIGINS`, junto com a data de `FRIDAY_PANEL_TOKEN_EXPIRES_AT`.
7. Deixar a API em `127.0.0.1`: o proxy ou túnel fala com ela por loopback e nenhuma outra interface é aberta.

A configuração do proxy real fica com o dono (S6) e não está neste documento.

## Túnel SSH em porta diferente

O túnel SSH (#614) leva a API para o aparelho do dono sem endereço público. Em porta diferente da do daemon, o navegador chama `http://127.0.0.1:7778`:

```sh
ssh -N -L 7778:127.0.0.1:7777 <usuario>@<endereco-da-vps>
```

Esse `Host` (`127.0.0.1:7778`) não é o da porta do painel. Sem a origem na lista, a API responde `403` com `Host não permitido.`. Defina no daemon:

```sh
FRIDAY_PANEL_ORIGINS=http://127.0.0.1:7778
```

Reinicie o daemon. A origem é de loopback, então `http://` é aceito aqui.

## Trocar o token

O token não troca sem reiniciar o daemon (D119, item 4):

1. Gere um token novo com o formato de `FRIDAY_PANEL_TOKEN` (só letras e números, pelo menos 32 caracteres).
2. Defina o token novo em `FRIDAY_PANEL_TOKEN` e uma nova data em `FRIDAY_PANEL_TOKEN_EXPIRES_AT`, a no máximo 90 dias.
3. Reinicie o daemon. O token antigo deixa de valer na hora; o antigo e o novo nunca valem juntos.
4. Abra o painel de novo e informe o token novo.

Atenção: uma aba do painel aberta com o token antigo continua consultando a API e enche o limite de tentativas. Depois de reiniciar, o painel pode responder `Muitas tentativas recusadas. Tente de novo em instantes.` por até 60 s. Feche as abas antigas e espere a janela passar.

## Login por usuário: avaliação

A D111 (item 8) pediu a avaliação do login por usuário e a D119 (item 6) decidiu avaliar agora, em documento, e construir depois. A construção fica no épico #500 (sub-issue 8).

### Opções

| Opção                                               | Como funciona                                                                                          | Vantagens                                                       | Custos e riscos                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Token único com o login do proxy                    | O proxy autentica a pessoa; a API confere só o token único do painel. É o que existe hoje.             | Nada a construir; um dono, um token, troca simples (D119).      | Todos os usuários do proxy dividem o token; não há quem fez o quê; o contador de recusas é único.      |
| Login por usuário na API                            | A API guarda usuários, credenciais e sessões e identifica quem aprova cada run.                        | Rastro por usuário sem depender do proxy.                       | Muito a construir e a proteger (senhas, sessões, recuperação); amplia a superfície de ataque.          |
| Login por usuário no proxy com identidade repassada | O proxy autentica e repassa a identidade (por exemplo em um cabeçalho); a API confia nesse cabeçalho. | A API não guarda credenciais; o rastro vem da identidade.       | A API passa a confiar em um cabeçalho do proxy; se o proxy for contornado, a identidade pode ser forjada. |

### Recomendação

Só avaliar agora. Manter o token único com o login do proxy e construir o login por usuário no épico #500, como o dono decidiu (D119). Com um único dono usando o painel, a necessidade de rastro por usuário ainda não existe.

### Quando construir

Quando mais de uma pessoa precisar usar o painel, quando for preciso saber quem aprovou ou rejeitou cada run, ou quando o épico #500 chegar à sub-issue 8. Antes de escolher entre as duas opções de login por usuário, decida de quem é a confiança sobre a identidade: da API (opção `Login por usuário na API`) ou do proxy (opção `Login por usuário no proxy com identidade repassada`).

## Siglas

- **API:** Application Programming Interface.
- **CORS:** Cross-Origin Resource Sharing.
- **CSS:** Cascading Style Sheets.
- **HTML:** HyperText Markup Language.
- **HTTPS:** HyperText Transfer Protocol Secure.
- **SSH:** Secure Shell.
- **TLS:** Transport Layer Security.
- **UTC:** Coordinated Universal Time.
- **VPN:** Virtual Private Network.
