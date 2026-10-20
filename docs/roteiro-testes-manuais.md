# Roteiro de testes manuais — ambiente de produção

Roteiro para uma pessoa testar o sistema **publicado**, pela interface, cobrindo todas as telas e
todas as ações disponíveis para cada papel. Os testes de erro vêm com o passo a passo que faz o
erro aparecer na tela, e com a mensagem exata que deve ser exibida.

Este roteiro é para o ambiente da Vercel descrito em `docs/deploy.md` — o mesmo banco que guarda
os dados do piloto na loja. Por isso a seção 2 tem regras que **não existem** num teste local.
Tudo o que os testes gravam entra nos números do dashboard e do artigo do TCC até ser removido.
Por isso todo dado de teste nasce marcado com o prefixo `ZZ-`, e sai do banco pelo script da
seção 19.

A massa de dados que os testes usam é criada por um script, a partir de uma planilha (seção 2.3).
Depois disso, os testes seguem a ordem em que a loja usa o sistema: entra, cadastra produto,
recebe mercadoria, imprime etiqueta, vende, resolve vencidos, acompanha alertas e confere o
dashboard. Vários testes dependem do estado deixado pelos anteriores. Por isso, **execute na
ordem** na primeira rodada.

---

## 1. Preparação

### 1.1 Endereços e acessos — preencha antes de começar

| Item | Valor |
|---|---|
| Frontend | `https://__________.vercel.app` |
| Backend (API) | `https://__________.vercel.app` |
| Conta de gestor para os testes | `________________` |
| Conta de atendente para os testes | `________________` |
| Quem tem acesso ao terminal / Vercel | `________________` |

As contas de teste são criadas no T-US-02 pela tela **Contas de acesso**. Enquanto elas não
existem, os primeiros testes usam a conta real da gestora — não há como fugir disso, porque é ela
quem cria as demais.

### 1.2 O que é preciso ter em mãos

| Item | Observação |
|---|---|
| Navegador | Chrome ou Edge atualizado, com as ferramentas de desenvolvedor (F12) |
| Segunda sessão | Uma janela anônima ou outro navegador, para os testes com duas pessoas ao mesmo tempo |
| Celular | Para câmera, PWA e notificação push. Em produção o sistema está em HTTPS, então tudo isso funciona |
| Impressora | Para o teste de etiquetas (T-ET-03) e para ler um QR impresso com a câmera (T-LQ-21) |
| Terminal com acesso ao backend | Para o backup e a massa de dados (seção 2.3), para os testes de alerta (seção 12) e para a limpeza (seção 19). Precisa do repositório clonado, com `npm install` feito em `backend/`, e da string de conexão **direta** do Neon. Pode ser outra pessoa |

### 1.3 Antes de começar, confirme que a publicação está de pé

Estes quatro passos são da seção 5 de `docs/deploy.md`. Se algum falhar, **pare**: o problema é
de configuração, e não adianta seguir com o roteiro.

**T-PD-01: a API responde**
1. Abra `https://<api>.vercel.app/health` no navegador.

Esperado: `{"status":"ok"}`.

**T-PD-02: o cookie de sessão está correto para dois domínios**
1. Entre no sistema.
2. F12 → Application → Cookies → o domínio da **API**.

Esperado: existe o cookie `sessao`, marcado como `Secure`, `HttpOnly` e `SameSite=None`. Sem isso
o login não se sustenta entre o frontend e a API, que estão em domínios diferentes.

**T-PD-03: abrir uma tela direto pela URL**
1. Em uma aba anônima (sem o app instalado), digite `https://<frontend>.vercel.app/leitura`.

Esperado: abre a tela de login do sistema, **não** o 404 da Vercel.

**T-PD-04: primeira requisição do dia (função fria + banco suspenso)**
1. Deixe o sistema sem uso por 20 minutos.
2. Faça um login e, em seguida, uma leitura de QR, cronometrando cada um.

Esperado: as duas completam. Anote os tempos: `login ____ s`, `leitura ____ s`. É o pior caso do
balcão, e o número interessa ao piloto — não é falha, a menos que a operação dê erro.

---

## 2. Regras para testar em produção

### 2.1 O que fica gravado, e o que a limpeza remove

- **Pela interface, nada se desfaz.** Saída, descarte e venda autorizada não têm desfazer, e o
  `EventoLog` é append-only: o banco recusa apagar ou alterar essas linhas, tanto pela aplicação
  quanto por ferramenta administrativa.
- **Até a limpeza, os números do dashboard contam o que foi feito nos testes.** Uma venda de
  teste é uma saída registrada como qualquer outra.
- **O script de limpeza (seção 19) remove tudo o que pertence a um produto `ZZ-`.** Isso inclui
  produtos, unidades, saídas, descartes, vendas autorizadas, alertas e os eventos deles no
  `EventoLog`. É a única exceção à regra append-only, e ela vale só para o prefixo `ZZ-`.
- **O que a limpeza não alcança, e fica:** as contas `TESTE …` (contas nunca são excluídas; elas
  são desativadas), as janelas de alerta criadas nos testes (são inativadas) e o registro das
  leituras de códigos que não existem (T-LQ-06). Esse registro não aponta para produto nenhum e
  não entra em nenhum número do dashboard.

### 2.2 As cinco regras

1. **Nunca leia a etiqueta de um frasco real da loja.** Uma leitura confirmada dá baixa de
   verdade no estoque. Use apenas as unidades criadas por este roteiro.
2. **Todo produto de teste tem código interno começando em `ZZ-`, com o hífen.** Os da planilha
   já vêm assim. Os criados à mão nos testes também precisam vir: `ZZ-OMEGA`, `ZZ-P01`, etc. O
   prefixo é **o que a limpeza procura**. Um produto de teste sem ele fica no banco para sempre,
   com tudo o que foi feito com ele. E, pelo mesmo motivo, nenhum produto real pode ter código
   começando em `ZZ-`. As contas de teste têm nome começando em "TESTE".
3. **Anote a janela dos testes** — data e hora de início e de fim: `____/____ ____h` até
   `____/____ ____h`. Depois da limpeza, o dashboard dessa janela deve mostrar só a operação real
   da loja (seção 19). Se a limpeza não for feita antes da análise dos dados do piloto, a janela
   é o único jeito de separar os números.
4. **Escolha o horário.** O teste de excesso de tentativas de login (T-AU-06) trava o login de
   **todo mundo que estiver na mesma conexão de internet** por um minuto. Faça os testes fora do
   horário de atendimento, ou avise a loja.
5. **Não desative a única conta de gestor.** Os testes de desativação são feitos na conta de
   teste, nunca na conta real da gestora.

### 2.3 Backup e massa de dados, antes de começar

Quem tem acesso ao terminal faz estes passos. O roteiro completo dos scripts está em
`docs/deploy.md`, seção 7.1.

**1. Backup.**

```bash
pg_dump "<url-direta>" --format=custom --file="backup-antes-dos-testes-$(date +%F).dump"
```

**2. Criar a massa de dados.** A planilha `backend/dados-ficticios/produtos-ficticios.csv` já
contém a massa da seção 3.1. As validades são relativas ao dia em que o script roda (`HOJE+60`,
`HOJE-5`), então **rode no mesmo dia dos testes**.

```bash
cd backend
DATABASE_URL="<url-direta>" npm run ficticios:cadastrar -- <email-da-conta-de-gestor>
```

A primeira linha da saída mostra o banco de destino. Confira que é o de produção. O e-mail é o de
uma conta que já existe e está ativa. Ela aparece como quem registrou as unidades. As contas
`TESTE …` só são criadas no T-US-02, então aqui se usa a conta real da gestora. Isso não fica no
histórico dela, porque a limpeza remove essas unidades.

Esperado: para cada produto, a linha `ZZ-…: criado, N unidade(s)` e, abaixo dela, os códigos
`PRF-XXXXXX` com a validade de cada um. **Copie os códigos para a tabela da seção 3.1.** Os
testes seguintes se referem a eles por apelido. Se aparecer `já existia, pulado`, a massa é de
uma rodada anterior e as validades dela estão defasadas: rode a limpeza da seção 19 e cadastre
de novo.

Se a planilha tiver erro, o script lista cada um com o número da linha e **não grava nada**.

**3. Conferir pela interface.** Entre como gestor, abra **Etiquetas**, escolha `ZZ-DELTA` e clique
em **Carregar etiquetas**.

Esperado: 3 etiquetas, com os códigos de D1, D2 e D3 nessa ordem, e as validades `HOJE+10`,
`HOJE+25` e `HOJE+45`. As unidades criadas pelo script são iguais às cadastradas pela tela: têm
código, etiqueta e evento de cadastro.

**Voltar o banco ao estado anterior** é possível, restaurando esse backup. Mas isso **apaga também
o que a loja registrou durante os testes**, então só vale se o piloto ainda não começou. O caminho
normal é a limpeza da seção 19.

### 2.4 Testes que criam bastante dado

Os testes marcados com **💾** criam dezenas de produtos ou unidades só para exercitar paginação e
limites. A limpeza da seção 19 remove esses dados também, desde que tenham o prefixo `ZZ-`. Até
lá, eles inflam o **"Estoque agora"** do dashboard. Se o piloto já está em andamento, faça a
limpeza no mesmo dia.

---

## 3. Convenções do roteiro

- **HOJE** é a data em que o teste é executado. `HOJE+10` significa 10 dias depois de hoje e
  `HOJE-5` significa 5 dias antes.
- Datas são digitadas no campo de data do navegador. Na tela aparecem como `dd/mm/aaaa`.
- Os códigos das unidades (`PRF-XXXXXX`) são gerados pelo sistema. Os da massa de dados vêm da
  saída do script (seção 2.3) e são anotados na tabela da seção 3.1. Os das unidades criadas
  durante os testes aparecem na tabela do recebimento. Os testes se referem a eles por apelido
  (ex.: **A1**, **B1**).
- **Resultado esperado** diz o que tem que aparecer. Qualquer diferença é falha e deve ser
  anotada na folha de registro (seção 20), com print da tela.
- Mensagens entre aspas devem aparecer **exatamente** assim.

### 3.1 Massa de dados

Ela é criada pelo script, no passo 2 da seção 2.3, a partir de
`backend/dados-ficticios/produtos-ficticios.csv`:

| Produto | Código interno | Unidades (validade → apelido) | Serve para |
|---|---|---|---|
| TESTE Perfume Alfa | `ZZ-ALFA` | 2× `HOJE+60` → **A1, A2**; 2× `HOJE+200` → **A3, A4** | FIFO, bloqueio, empate |
| TESTE Perfume Beta | `ZZ-BETA` | 1× `HOJE-5` → **B1**; 1× `HOJE+100` → **B2** | Unidade vencida na leitura |
| TESTE Creme Gama | `ZZ-GAMA` | 1× `HOJE-3` → **G1**; 1× `HOJE-10` → **G2**; 1× `HOJE-20` → **G3** | Fila de descarte |
| TESTE Loção Delta | `ZZ-DELTA` | 1× `HOJE+10` → **D1**; 1× `HOJE+25` → **D2**; 1× `HOJE+45` → **D3** | Alertas |
| TESTE Óleo Épsilon | `ZZ-EPS` | nenhuma | Produto inativo, etiqueta vazia |

O script lista os códigos de cada produto **na mesma ordem das linhas da planilha**. O primeiro
código de `ZZ-ALFA` é A1, o segundo é A2, e assim por diante. Preencha:

| Apelido | Validade | Código | | Apelido | Validade | Código |
|---|---|---|---|---|---|---|
| **A1** | `HOJE+60` | `PRF-______` | | **G1** | `HOJE-3` | `PRF-______` |
| **A2** | `HOJE+60` | `PRF-______` | | **G2** | `HOJE-10` | `PRF-______` |
| **A3** | `HOJE+200` | `PRF-______` | | **G3** | `HOJE-20` | `PRF-______` |
| **A4** | `HOJE+200` | `PRF-______` | | **D1** | `HOJE+10` | `PRF-______` |
| **B1** | `HOJE-5` | `PRF-______` | | **D2** | `HOJE+25` | `PRF-______` |
| **B2** | `HOJE+100` | `PRF-______` | | **D3** | `HOJE+45` | `PRF-______` |

Os testes de cadastro e de recebimento pela tela (seções 6 e 7) usam um produto próprio,
`ZZ-OMEGA`, e os de importação usam `ZZ-IMP1` a `ZZ-IMP3`, para não mexer nessa massa.

---

## 4. Login e sessão

**T-AU-01: login como gestor**
1. Abra `https://<frontend>.vercel.app`.
2. Informe a conta e a senha do gestor e clique em **Entrar**.

Esperado: enquanto a requisição está em andamento, o botão mostra "Entrando…". A tela abre em
**Catálogo de produtos** (`/produtos`). No topo aparece o nome da pessoa seguido de "— Gestor" e o
botão **Sair**. As abas visíveis são: Leitura de QR, Catálogo de produtos, Fila de descarte,
Registrar recebimento, Alertas, Configurar alertas, Dashboard, Contas de acesso, Minha senha e
Etiquetas.

**T-AU-02: login como atendente**
1. Saia e entre com a conta de atendente.

Esperado: a tela abre em **Leitura de QR** (`/leitura`) e o topo mostra "— Atendente". Só três
abas aparecem: **Leitura de QR**, **Catálogo de produtos** e **Minha senha**.

**T-AU-03 (erro): senha errada**
1. Informe a conta do gestor com uma senha errada.

Esperado: "E-mail ou senha incorretos.". O usuário continua na tela de login.

**T-AU-04 (erro): e-mail que não existe**
1. Informe `ninguem@estoque.local` com qualquer senha.

Esperado: a mesma mensagem do T-AU-03, "E-mail ou senha incorretos.". O sistema não diz qual dos
dois campos está errado, e isso é intencional.

**T-AU-05 (erro): campos vazios ou e-mail malformado**
1. Clique em **Entrar** com os campos vazios.
2. Digite `gestor` (sem `@`) no e-mail e clique em **Entrar**.

Esperado: o navegador impede o envio e mostra o balão de validação no campo. Nenhuma mensagem vem
do sistema.

**T-AU-06 (erro): excesso de tentativas** ⚠️ *trava o login de toda a conexão por um minuto*
1. Erre a senha 10 vezes seguidas em menos de um minuto.
2. Tente de novo, agora com a senha **correta**.

Esperado: em algum momento aparece "Muitas tentativas seguidas. Aguarde um minuto e tente de
novo.". Depois de um minuto, o login com a senha correta funciona.

> Em produção o contador vive na memória de cada instância da função, e a Vercel pode ter mais de
> uma no ar. Pode ser preciso passar de 10 tentativas para ver a mensagem — o limite continua
> valendo, mas não é um teto exato. Se depois de 20 tentativas a mensagem não aparecer, anote como
> falha para investigação.

**T-AU-07: sessão sobrevive ao recarregar**
1. Logado, aperte F5.

Esperado: aparece "Verificando sessão…" por um instante e o usuário continua logado na mesma tela.

**T-AU-08: sair**
1. Clique em **Sair**.
2. Use o botão Voltar do navegador.

Esperado: a tela vai para o login. Voltar não reabre a tela protegida: o sistema redireciona para
`/login`.

**T-AU-09: URL protegida sem sessão**
1. Deslogado, digite `https://<frontend>.vercel.app/dashboard` na barra de endereço.

Esperado: redirecionamento para `/login`.

**T-AU-10 (erro): API fora do alcance ao abrir o sistema**

Em produção não dá para desligar o backend, então a falha é simulada bloqueando o endereço da API
no próprio navegador. Isso reproduz o mesmo sintoma de uma API fora do ar.
1. F12 → Network → clique com o botão direito em qualquer requisição → **Block request domain**,
   escolhendo o domínio da API. (No Edge/Chrome o bloqueio também pode ser adicionado à mão em
   Network conditions → Request blocking, com o padrão `*<api>.vercel.app*`.)
2. Recarregue o frontend.

Esperado: tela de login com o aviso "Não foi possível falar com o servidor. Verifique sua conexão
e tente novamente.". Tentar entrar mostra a mesma mensagem.

**T-AU-11 (erro): sair com a API fora do alcance**
1. Logado, ligue o bloqueio do T-AU-10.
2. Clique em **Sair**.

Esperado: a mensagem de falta de conexão aparece e o usuário **continua logado**. O sistema não
finge ter saído, porque o cookie de sessão continua válido. Tire o bloqueio e clique em **Sair**
de novo: agora sai. **Lembre de desligar o bloqueio antes de seguir.**

**T-AU-12 (erro): sessão expirada no meio do uso**
1. Logado como gestor, abra F12 → Application → Cookies → domínio da **API** e apague o cookie
   `sessao`.
2. Sem recarregar, vá ao Catálogo e tente cadastrar um produto.

Esperado: "Sessão ausente ou expirada. Faça login novamente.". Ao recarregar a página, o sistema
volta para o login.

---

## 5. Navegação e permissões por papel

**T-NV-01: atendente não chega a tela de gestor pela URL**
1. Logado como atendente, digite na barra de endereço: `/dashboard`, `/descartes`, `/recebimento`,
   `/alertas`, `/alertas/configuracao`, `/usuarios` e `/etiquetas`.

Esperado: em todas elas o sistema redireciona para `/leitura`.

**T-NV-02: URL desconhecida**
1. Como gestor, acesse `/qualquer-coisa`. Depois acesse `/login`.

Esperado: nos dois casos o sistema redireciona para `/produtos`, a tela inicial do gestor.

**T-NV-03: aba ativa**
1. Como gestor, clique em **Configurar alertas**.

Esperado: só a aba "Configurar alertas" aparece destacada. A aba "Alertas" não fica destacada.

---

## 6. Catálogo de produtos (gestor)

**T-PR-01: cadastrar produto**
1. Em **Catálogo de produtos**, preencha: Código interno `zz-omega`, Nome `TESTE Perfume Ômega`,
   Marca `Marca X` e Categoria `Perfume`.
2. Clique em **Cadastrar**.

Esperado: o botão mostra "Cadastrando…". O formulário é limpo e o produto aparece na tabela com o
código **`ZZ-OMEGA`**, convertido para maiúsculas, e a situação "Ativo".

**T-PR-02: a massa do script aparece no catálogo**
1. Procure na tabela os cinco produtos criados pelo script: `ZZ-ALFA`, `ZZ-BETA`, `ZZ-GAMA`,
   `ZZ-DELTA` e `ZZ-EPS`.

Esperado: os cinco aparecem com a situação "Ativo", com o nome, a marca ("Marca Fictícia") e a
categoria da planilha. O total mostrado inclui os produtos reais da loja.

**T-PR-03 (erro): código interno duplicado**
1. Cadastre outro produto com o código ` Zz-Alfa ` (com espaços e letras misturadas).

Esperado: "Já existe um produto com esse código interno.". Os campos continuam preenchidos.

**T-PR-04 (erro): campo obrigatório vazio**
1. Deixe **Marca** vazia e clique em **Cadastrar**.

Esperado: o navegador impede o envio e aponta o campo vazio.

**T-PR-05 (erro): texto longo demais**
1. Cole no campo Nome um texto com mais de 120 caracteres e preencha os outros campos.
2. Clique em **Cadastrar**.

Esperado: "Alguns campos do formulário não foram aceitos. Confira os dados e tente de novo.".

**T-PR-06: buscar**
1. Digite `beta` em "Buscar por nome ou código" e clique em **Buscar**.
2. Busque por `ZZ-GAMA`.
3. Busque por `inexistente-zzz`.
4. Busque por `ZZ` e confira que os seis produtos de teste aparecem juntos.

Esperado: (1) aparece o TESTE Perfume Beta. (2) Aparece o TESTE Creme Gama, porque a busca também
funciona pelo código. (3) Aparece "Nenhum produto encontrado.". (4) Os seis produtos de teste
aparecem: os cinco do script e o `ZZ-OMEGA`.

**T-PR-07: inativar e reativar**
1. Na linha de `ZZ-EPS`, clique em **Inativar**.
2. Marque **Mostrar produtos inativos**.
3. Clique em **Reativar** na linha de `ZZ-EPS`.
4. Clique em **Inativar** outra vez e deixe o produto inativo.

Esperado: (1) o produto some da lista. (2) Ele volta, com a linha esmaecida e a situação
"Inativo". (3) A situação volta a ser "Ativo". (4) O produto fica inativo, como a seção 7 precisa.

**T-PR-08: paginação** 💾
1. Se o catálogo real já passa de 20 produtos, use a paginação que já existe e pule o passo 2.
2. Se não passa, cadastre produtos `ZZ-P01` a `ZZ-P17` até a lista ultrapassar 20.

Esperado: o título mostra "página 1 de 2". **Próxima** leva à página 2 e **Anterior** fica
desabilitado na página 1. Buscar ou marcar "Mostrar produtos inativos" volta para a página 1.

> Se criou os `ZZ-P*`, inative todos ao final deste teste. A limpeza da seção 19 os remove.

**T-PR-09: atendente só consulta**
1. Entre como atendente e abra **Catálogo de produtos**.

Esperado: não aparece o formulário "Cadastrar produto", nem a seção "Importar produtos de
planilha", nem a coluna **Ações**. A busca e a caixa "Mostrar produtos inativos" continuam
funcionando.

### 6.1 Importar produtos de planilha (gestor)

Os produtos importados aqui têm código `ZZ-IMP…`, para que a limpeza da seção 19 os remova.
Nunca importe a planilha real da loja como teste: ela é importada uma vez só, na carga do
catálogo.

**T-PR-10: baixar o modelo**
1. Na seção "Importar produtos de planilha", clique em **Baixar planilha modelo**.
2. Abra o arquivo baixado no Excel ou no LibreOffice.

Esperado: o arquivo `modelo-produtos.csv` abre com as colunas **código interno**, **nome**,
**marca** e **categoria**, com os acentos certos.

**T-PR-11: importar uma planilha salva pelo Excel**
1. No modelo, preencha três linhas: `zz-imp1` TESTE Perfume Clássico, `ZZ-IMP2` TESTE Loção
   Ação, `ZZ-IMP3` TESTE Óleo Íris. Marca e categoria livres, com acento.
2. Acrescente uma coluna `Preço` no fim, com qualquer valor.
3. Salve como **CSV (separado por vírgulas)**, o formato comum do Excel, e **não** como "CSV
   UTF-8".
4. Escolha o arquivo em **Arquivo CSV** e clique em **Importar**.

Esperado: o botão mostra "Importando…" e, em seguida, a nota verde "3 produto(s)
importado(s).". O catálogo recarrega. Buscando por `ZZ-IMP`, aparecem os três produtos com os
códigos em maiúsculas e **os acentos certos** (Clássico, Ação, Óleo, Íris). A coluna `Preço`
foi ignorada.

**T-PR-12: reenviar a mesma planilha**
1. Escolha o mesmo arquivo e clique em **Importar** de novo.

Esperado: "0 produto(s) importado(s).", seguido de "3 código(s) já estavam cadastrados e foram
pulados:" e da lista "Linha 2: ZZ-IMP1", "Linha 3: ZZ-IMP2", "Linha 4: ZZ-IMP3". Nenhum produto é
duplicado nem alterado.

**T-PR-13 (erro): planilha com problemas**
1. Numa planilha nova, com o cabeçalho do modelo, preencha: `ZZ-IMP4` com o nome em branco;
   `ZZ-IMP5` completo; e `zz-imp5` de novo, completo.
2. Importe.

Esperado: em vermelho, "A planilha tem problemas e nada foi importado. Corrija as linhas abaixo
e envie de novo.", com a lista "Linha 2: nome em branco." e "Linha 4: código ZZ-IMP5 repetido
(já aparece na linha 3).". Buscando por `ZZ-IMP5`, **não** aparece nada: nem a linha correta
entrou.

**T-PR-14 (erro): coluna obrigatória faltando**
1. Apague a coluna **marca** da planilha do T-PR-13 e importe.

Esperado: a mesma mensagem vermelha, com "Linha 1: faltam as colunas marca. O cabeçalho precisa
ter código interno, nome, marca e categoria.".

---

## 7. Registrar recebimento (gestor)

**T-RC-01: recebimento com validades diferentes**
1. Em **Registrar recebimento**, escolha `ZZ-OMEGA — TESTE Perfume Ômega`.
2. Na linha 1, preencha Validade `HOJE+60` e Unidades `2`.
3. Clique em **Adicionar outra validade** e preencha a linha 2 com `HOJE+200` e `2`.
4. Confira o texto "Total: 4 unidade(s) neste recebimento.".
5. Clique em **Registrar recebimento**.

Esperado: aparece "4 unidade(s) cadastrada(s)" e uma tabela com 4 códigos `PRF-XXXXXX`, as
validades e a situação "Em estoque". O formulário volta a ter uma linha só.

**T-RC-02: unidade já vencida gera aviso, não recusa**
1. Escolha `ZZ-OMEGA`, com as linhas `HOJE-5` × 1 e `HOJE+100` × 1. Registre.

Esperado: as 2 unidades são cadastradas, e aparece em vermelho: "1 unidade(s) foram cadastradas já
vencidas (validade aaaa-mm-dd). Elas entram em estoque e serão barradas na venda.". A unidade
vencida de `ZZ-OMEGA` passa a aparecer também na Fila de descarte (seção 10).

**T-RC-03: remover linha**
1. Adicione 3 linhas e clique em **Remover** na do meio.
2. Deixe só uma linha.

Esperado: (1) a linha certa some. (2) Com uma linha só, o botão **Remover** fica desabilitado.

**T-RC-04 (erro): enviar sem produto ou sem validade**
1. Não escolha produto ou deixe uma validade vazia.

Esperado: o botão **Registrar recebimento** fica desabilitado.

**T-RC-05 (erro): quantidade fora do limite da linha**
1. Digite `0` em Unidades e tente registrar. Depois digite `201`.

Esperado: o navegador impede o envio e diz que o valor precisa estar entre 1 e 200.

**T-RC-06 (erro): lote maior que 500 unidades**
1. Escolha `ZZ-EPS` (reative-o antes) e crie 3 linhas com 200 unidades cada (total 600).
2. Registre.

Esperado: "Um recebimento aceita no máximo 500 unidades por vez.". **Nada é cadastrado** — este
teste não cria unidade nenhuma. Inative `ZZ-EPS` de novo depois.

**T-RC-07 (erro): produto inativado no meio do recebimento**
1. Na aba 1, abra **Registrar recebimento** e escolha `ZZ-DELTA`, sem registrar ainda.
2. Na aba 2, com o mesmo gestor, inative `ZZ-DELTA` no Catálogo.
3. Volte à aba 1, preencha uma validade e registre.

Esperado: "Este produto está inativo. Reative-o no catálogo antes de receber unidades.".
**Reative `ZZ-DELTA` depois.**

**T-RC-08: produto inativo não aparece na lista**
1. Abra o seletor de produto.

Esperado: `ZZ-EPS`, que está inativo, não aparece.

**T-RC-09: busca no seletor**
1. Busque por `gama` no campo "Buscar produto por nome ou código" e clique em **Buscar**.
2. Busque por `xyz-inexistente`.

Esperado: (1) o seletor mostra só o TESTE Creme Gama. (2) Aparece "Nenhum produto ativo
encontrado. Cadastre-o antes em Catálogo de produtos.".

---

## 8. Etiquetas (gestor)

**T-ET-01: imprimir etiquetas logo após o recebimento**
1. Registre um recebimento de `ZZ-ALFA` com 1 unidade em `HOJE+300` (é a **A5**).
2. Clique em **Imprimir etiquetas destas unidades**.

Esperado: a tela Etiquetas abre com "TESTE Perfume Alfa — 1 unidade(s) do recebimento" e mostra 1
etiqueta com o QR, o código em texto e "Val dd/mm/aaaa".

**T-ET-02: tamanho do símbolo**
1. Alterne entre 15 mm, 20 mm e 25 mm.

Esperado: o símbolo muda de tamanho. O rodapé mostra "símbolo de N mm". O padrão é 20 mm.

**T-ET-03: imprimir**
1. Clique em **Imprimir** e imprima de verdade — a folha é usada no T-LQ-21 e na validação física
   da RNF08 (tarefa T16).

Esperado: abre o diálogo de impressão. Na pré-visualização aparecem só as etiquetas e o rodapé,
sem menu, botões ou abas.

**T-ET-04: recarregar mantém o lote**
1. Com a folha do T-ET-01 aberta, aperte F5.

Esperado: a mesma folha continua na tela.

**T-ET-05: abrir em outra aba não carrega nada sozinho**
1. Copie a URL `/etiquetas` e abra em uma aba nova.

Esperado: aparece o seletor de produto. Nenhuma etiqueta é carregada automaticamente.

**T-ET-06: reimpressão do estoque de um produto**
1. No seletor, escolha `ZZ-ALFA` e clique em **Carregar etiquetas**.

Esperado: aparece "TESTE Perfume Alfa — todas as unidades em estoque", com as etiquetas em **ordem
de validade crescente** (A1, A2, A3, A4, A5).

**T-ET-07: botão só habilita com produto escolhido**

Esperado: **Carregar etiquetas** fica desabilitado enquanto nenhum produto está selecionado.

**T-ET-08: produto sem unidades**
1. Clique em **Escolher outro produto**, reative `ZZ-EPS`, escolha-o e carregue.

Esperado: "Nenhuma unidade em estoque para etiquetar neste produto.". Inative `ZZ-EPS` de novo.

**T-ET-09: paginação da folha** 💾
1. Receba 150 unidades de `ZZ-EPS` (reativado) com validade `HOJE+365` e clique em **Imprimir
   etiquetas destas unidades**.

Esperado: aparecem 100 etiquetas na página 1, os botões Anterior/Próxima e o texto "Imprima uma
página por vez.". O rodapé mostra "100 de 150 etiqueta(s) · página 1 de 2".

> Este teste cria 150 unidades, que ficam em estoque até a limpeza da seção 19 e até lá inflam o
> "Estoque agora" do dashboard. Se o piloto já começou, faça com 101 unidades, o mínimo para haver
> duas páginas. Não imprima esta folha.

---

## 9. Leitura de QR: vereditos

Faça os testes com a conta de **atendente**, pela digitação manual, salvo quando o teste indicar
outra coisa. A câmera é testada na seção 9.3.

> Lembrete da regra 1 da seção 2: só leia códigos das unidades `ZZ-*` criadas por este roteiro.
> Uma leitura confirmada dá baixa de verdade.

### 9.1 Fluxo normal

**T-LQ-01: bloqueio de FIFO**
1. Em **Leitura de QR**, digite o código de **A3** (`HOJE+200`) e clique em **Ler código**.

Esperado: aparece o bloco **"Não é esta unidade"** com a mensagem "Devolva esta unidade à
prateleira (validade …). Saia primeiro com a de validade … — código PRF-…". O código correto
aparece em destaque e é o de A1 ou A2, que são as de `HOJE+60`. Em "Na sua mão" aparece A3 e em
"Saia com esta" aparece a correta. O texto de rodapé diz "Tentativa 1 neste produto.". O campo de
código é limpo.

**T-LQ-02: tentativas acumulam**
1. Leia **A4** (`HOJE+200`).

Esperado: um novo bloqueio, agora com "Tentativa 2 neste produto.".

**T-LQ-03: substituição confirmada**
1. Leia **A1**.

Esperado: aparece o bloco **"Saída registrada"** com "Saída registrada: TESTE Perfume Alfa
(Marca X), validade …".

**T-LQ-04: empate de validade, qualquer uma serve**
1. Leia **A2**, que tem a mesma validade que A1 tinha.

Esperado: "Saída registrada" direto, sem bloqueio.

**T-LQ-05 (erro): unidade já vendida**
1. Leia **A1** outra vez.

Esperado: o bloco **"Unidade já baixada"** aparece com "Esta unidade já saiu do estoque — foi
vendida ou descartada. Leia outra unidade." e "Código lido: PRF-…".

**T-LQ-06 (erro): código não cadastrado**
1. Digite `PRF-ZZZZZZ` e clique em **Ler código**.
2. Digite `abc` e clique em **Ler código**.

Esperado: nos dois casos aparece o bloco **"Código não encontrado"** com "Código não cadastrado.
Confira a etiqueta ou digite o código impresso abaixo do QR.".

**T-LQ-07: tolerância de digitação**
1. Pegue o código de **A3** (ex.: `PRF-1K0Q7M`) e digite em minúsculas, com espaços nas pontas.
   Onde houver `0`, digite `O`, e onde houver `1`, digite `I` ou `L` (ex.: ` prf-Ik0q7m `).

Esperado: o sistema reconhece a unidade A3. Como A3 já é a de menor validade em estoque, aparece
"Saída registrada".

**T-LQ-08: botão Ler código**
1. Com o campo vazio ou só com espaços, observe o botão.

Esperado: **Ler código** fica desabilitado.

**T-LQ-09: ler outra unidade**
1. Com um resultado na tela, clique em **Ler outra unidade**.

Esperado: o resultado some e a tela fica pronta para a próxima leitura.

**T-LQ-10: encerrar atendimento**
1. Clique em **Encerrar atendimento**.

Esperado: o resultado some. O texto "Atendimento em andamento. As saídas desta sequência ficam
agrupadas no relatório." continua na tela, porque um novo atendimento começa.

**T-LQ-11: vencida não trava o FIFO das outras unidades**
1. Leia **B2** (`HOJE+100`), sabendo que B1 (`HOJE-5`) está vencida no mesmo produto.

Esperado: "Saída registrada" direto. A unidade vencida não é apontada como "a que deve sair
primeiro".

### 9.2 Unidade vencida no balcão

Para os testes a seguir, cadastre (como gestor) mais unidades vencidas de `ZZ-BETA`: 4 unidades
`HOJE-5`, que serão **B3, B4, B5 e B6**.

**T-LQ-12: atendente lê unidade vencida**
1. Como atendente, leia **B3**.

Esperado: aparece o bloco **"Unidade vencida"** com "TESTE Perfume Beta (…) venceu em dd/mm/aaaa.
Esta unidade não sai pelo fluxo normal.". Logo abaixo, em "O que fazer com esta unidade", aparece
só o caminho **"A unidade está vencida mesmo"**, com o campo Motivo e o botão **Registrar
descarte**. Aparece também o texto "Corrigir a validade cadastrada e autorizar a venda de unidade
vencida são ações do gestor.".

**T-LQ-13: descarte pelo atendente, sem motivo**
1. Clique em **Registrar descarte** com o Motivo vazio.

Esperado: aparece o bloco **"Descarte registrado"** com "Descarte registrado: TESTE Perfume Beta
(…), validade …. A unidade saiu do estoque e entra no relatório de perdas.".

**T-LQ-14: gestor vê os três caminhos**
1. Como gestor, em **Leitura de QR**, leia **B4**.

Esperado: aparecem três caminhos, nesta ordem: **"A validade está errada no cadastro"** (campo de
data já preenchido com a validade atual e botão **Corrigir validade**), **"A unidade está vencida
mesmo"** e o botão secundário **Autorizar a venda mesmo assim**.

**T-LQ-15 (erro): corrigir para a mesma data**
1. Em B4, clique em **Corrigir validade** sem mudar a data.

Esperado: "A validade informada é igual à que já está cadastrada. Não há o que corrigir.".

**T-LQ-16: corrigir validade para uma data futura**
1. Em B4, mude a data para `HOJE+400` e clique em **Corrigir validade**.

Esperado: o sistema refaz a validação. Como não sobrou outra unidade não vencida de ZZ-BETA com
validade menor, o resultado é **"Saída registrada"**: a unidade foi vendida com a nova validade.

> Variação: corrija para outra data **no passado** (ex.: `HOJE-1`). O resultado volta a ser
> "Unidade vencida", agora com a nova data.

**T-LQ-17: descarte com motivo**
1. Leia **B5**, escreva o motivo `Frasco vazando` e clique em **Registrar descarte**.

Esperado: "Descarte registrado".

**T-LQ-18: override. Justificativa mínima e cancelamento**
1. Leia **B6** e clique em **Autorizar a venda mesmo assim**.
2. Leia o aviso sobre a legislação de defesa do consumidor.
3. Digite `curta` na justificativa.
4. Clique em **Cancelar**.

Esperado: (1) abre o formulário "Autorizar a venda desta unidade vencida". (3) Aparece "Faltam 5
caracteres para a justificativa." e o botão **Autorizar venda** fica desabilitado. (4) O formulário
fecha e volta o botão secundário.

**T-LQ-19: override concluído**
1. Abra o override de novo, digite `Teste do roteiro de homologacao` e clique em **Autorizar
   venda**.

Esperado: aparece o bloco **"Venda autorizada"** com "Venda de unidade vencida autorizada por
<nome do gestor>: TESTE Perfume Beta (…), validade …. O registro desta autorização é permanente.".

> A justificativa aparece no dashboard até a limpeza da seção 19. Escreva um texto que deixe
> claro que foi teste, como o sugerido acima.

**T-LQ-20 (erro): outra pessoa resolveu a unidade antes**
1. Cadastre mais uma unidade `ZZ-BETA` com validade `HOJE-5` (**B7**).
2. Na janela 1 (gestor), leia **B7** e deixe o painel de exceção aberto.
3. Na janela 2 (atendente, em janela anônima), leia **B7** e registre o descarte.
4. Volte à janela 1 e clique em **Registrar descarte**.

Esperado: na janela 1 o painel some e aparece "Esta unidade já saiu do estoque — foi vendida ou
descartada. Nada a resolver.". A tela volta ao estado de nova leitura.

### 9.3 Câmera

Em produção o sistema está em HTTPS, então a câmera funciona no celular e no computador.

**T-LQ-21: ler pela câmera**
1. Pegue a folha impressa no T-ET-03.
2. No celular, abra a Leitura de QR, clique em **Ligar câmera**, permita o acesso e aponte para o
   QR da unidade **A5**.

Esperado: o vídeo aparece, o veredito sai sozinho, sem tocar na tela, e é registrado **uma vez
só**, mesmo com o papel parado na frente da câmera.

**T-LQ-22: sequência de frascos pela câmera**
1. Com a câmera ligada, aponte para outra etiqueta da folha.

Esperado: um veredito novo aparece sem precisar clicar em "Ler outra unidade".

**T-LQ-23: desligar câmera**

Esperado: **Desligar câmera** para o vídeo e volta o botão **Ligar câmera**.

**T-LQ-24 (erro): permissão de câmera negada**
1. No cadeado da barra de endereço, bloqueie a câmera para o site e recarregue.
2. Clique em **Ligar câmera**.

Esperado: "Permissão de câmera negada. Libere a câmera nas configurações do navegador ou digite o
código abaixo.". A digitação manual continua funcionando. Libere a câmera de novo ao terminar.

**T-LQ-25 (erro): aparelho sem câmera**
1. Em um computador sem webcam, clique em **Ligar câmera**.

Esperado: "Nenhuma câmera encontrada neste aparelho. Digite o código abaixo.".

**T-LQ-26 (erro): câmera em uso**
1. Abra a webcam em outro aplicativo (ex.: uma videochamada) e clique em **Ligar câmera**.

Esperado (depende do sistema operacional): "A câmera está em uso por outro aplicativo. Feche-o ou
digite o código abaixo.".

**T-LQ-27: etiqueta física de verdade (fecha a RNF08 / T16)**
1. Cole etiquetas de 15 mm, 20 mm e 25 mm em frascos reais, incluindo um pequeno e um de
   superfície curva e brilhante.
2. Leia cada uma com o celular, na luz da loja, com o aparelho a distância normal de balcão.

Esperado: anote qual tamanho lê de primeira e qual falha, por tipo de frasco. **Este resultado
alimenta a tarefa T16 e o artigo** — registre mesmo que tudo funcione.

### 9.4 Sem conexão (RNF07)

**T-LQ-28 (erro): rede cai com a tela aberta**
1. Na Leitura de QR, abra F12 → Network e mude "No throttling" para **Offline**. No celular, ligue
   o modo avião.

Esperado: a tela troca para **"Sem conexão com o servidor"**, com o texto de que a leitura não
funciona offline e o botão **Tentar de novo**. O campo de código e a câmera somem, e qualquer
veredito que estava na tela desaparece.

**T-LQ-29: conexão volta**
1. Volte a rede para "No throttling" (ou desligue o modo avião).

Esperado: a tela de leitura volta sozinha ou depois de **Tentar de novo**. Ela volta **vazia**, sem
reexibir o veredito antigo.

**T-LQ-30 (erro): a API não responde, mas há internet**
1. Ligue o bloqueio do domínio da API (T-AU-10), com a rede normal.
2. Digite um código e clique em **Ler código**.

Esperado: aparece a mensagem de falta de conexão e em seguida a tela **"Sem conexão com o
servidor"**. Com o bloqueio ligado, **Tentar de novo** mantém o portão. Tire o bloqueio e clique em
**Tentar de novo**: a leitura volta.

**T-LQ-31 (erro): conexão cai durante a exceção de vencido**
1. Cadastre uma unidade `ZZ-GAMA` com validade `HOJE-1` e leia o código dela.
2. Com o painel aberto, coloque o navegador **Offline** e clique em **Registrar descarte**.

Esperado: a tela vai para "Sem conexão com o servidor", sem mensagem genérica de erro. Volte a
rede: a unidade continua em estoque, e dá para lê-la e resolvê-la de novo.

---

## 10. Fila de descarte (gestor)

> A fila mostra **todas** as unidades vencidas em estoque, inclusive as reais da loja. Resolva
> apenas as dos produtos `ZZ-*`.

**T-FD-01: lista de vencidas**
1. Abra **Fila de descarte**.

Esperado: aparece "N unidade(s) vencida(s) em estoque — página 1 de N". As unidades estão
ordenadas da **mais antiga** para a mais recente. Entre elas estão G3 (20 dias), G2 (10 dias) e G1
(3 dias). Cada item mostra produto, marca, código interno, etiqueta, validade e "Vencida há N
dias".

**T-FD-02: abrir e trocar o painel**
1. Clique em **Resolver** em G3. Depois clique em **Resolver** em G2.

Esperado: só um painel fica aberto por vez. O painel **não** tem a opção "Autorizar a venda mesmo
assim", só **Corrigir validade** e **Registrar descarte**.

**T-FD-03: descartar pela fila**
1. Em G3, escreva o motivo `Vencido na prateleira` e clique em **Registrar descarte**.

Esperado: aparece a nota verde "Descarte registrado: …". G3 some da lista e o total diminui 1.

**T-FD-04: corrigir para uma data futura**
1. Em G2, corrija a validade para `HOJE+90`.

Esperado: a lista recarrega e G2 some. A nota mostra a mensagem do servidor: verde ("Saída
registrada…") se a revalidação confirmou a venda, ou vermelha ("Devolva esta unidade…") se houver
outra unidade de ZZ-GAMA com validade menor e ainda não vencida.

> Observação para o avaliador: corrigir a validade **pela fila** pode resultar em **venda**, se a
> revalidação confirmar a saída. Anote se esse comportamento parecer surpreendente para quem usa.

**T-FD-05 (erro): corrigir para a mesma data**
1. Em G1, clique em **Corrigir validade** sem mudar a data.

Esperado: "A validade informada é igual à que já está cadastrada. Não há o que corrigir.".

**T-FD-06 (erro): unidade já resolvida em outra janela**
1. Na janela 1, abra **Resolver** em G1.
2. Na janela 2 (gestor), leia G1 na Leitura de QR e registre o descarte.
3. Na janela 1, clique em **Registrar descarte**.

Esperado: a nota vermelha "Esta unidade já saiu do estoque — foi vendida ou descartada. Nada a
resolver." aparece e a lista recarrega sem G1.

**T-FD-07 (erro): a unidade deixou de estar vencida**
1. Cadastre uma unidade `ZZ-GAMA` com `HOJE-2` (**G4**) e outra com `HOJE+500` (**G5**).
2. Na janela 1, abra **Resolver** em G4.
3. Na janela 2, abra **Resolver** em G4 e corrija a validade para `HOJE+600`. A revalidação bloqueia
   por FIFO, porque G5 tem validade menor, e G4 continua em estoque, agora não vencida.
4. Na janela 1, clique em **Registrar descarte**.

Esperado: na janela 1 aparece "Esta unidade não está vencida. Os três caminhos da exceção valem
apenas para unidade com validade expirada — a saída dela segue o fluxo normal de leitura.".

**T-FD-08: fila vazia**
1. Só é observável se **nenhuma** unidade vencida existir no estoque, incluindo as reais.

Esperado: "Nenhuma unidade vencida em estoque.". Se a loja tem vencidas de verdade, marque como
"não executado" — não resolva unidade real para ver esta tela.

**T-FD-09 (erro): falha ao carregar**
1. Ligue o bloqueio do domínio da API e troque de aba para **Fila de descarte**.

Esperado: aparece a mensagem de falta de conexão com o servidor. Tire o bloqueio depois.

---

## 11. Configurar alertas (gestor)

> As janelas de antecedência valem para a **loja inteira**. Ao criar uma janela de teste, a
> varredura seguinte vai gerar alertas também para os produtos reais que caírem nela. Isso não
> estraga nada, mas explica um número maior de alertas no dia seguinte. Desfaça as janelas de
> teste ao terminar (seção 19).

**T-CA-01: janelas existentes**
1. Abra **Configurar alertas**.

Esperado: a tabela mostra as janelas em uso, da mais larga para a mais estreita. No mínimo existe
a de "30 dias antes · No aplicativo", criada na implantação. O formulário vem preenchido com 30 e
"No aplicativo".

**T-CA-02: adicionar janela**
1. Escolha uma antecedência **que ainda não exista** (ex.: `7`) e o canal **No aplicativo e push**.
   Clique em **Adicionar janela**.

Esperado: a nova linha aparece, e a tabela continua ordenada da mais larga para a mais estreita.

**T-CA-03 (erro): antecedência repetida**
1. Adicione outra janela com `30` dias (ou com a antecedência que já existe).

Esperado: "Já existe uma configuração ativa com essa antecedência. Altere a existente em vez de
criar uma segunda.". Os campos continuam preenchidos.

**T-CA-04 (erro): fora do intervalo 1–365**
1. Digite `0` e tente adicionar. Depois digite `366`, e depois `2.5`.

Esperado: o navegador impede o envio e mostra o limite ou o passo inteiro.

**T-CA-05: alterar**
1. Na janela de 7 dias, clique em **Alterar**, mude para `10` e canal "No aplicativo" e clique em
   **Salvar**.
2. Clique em **Alterar** de novo e depois em **Cancelar**.
3. Clique em **Alterar** e em **Salvar** sem mudar nada.

Esperado: (1) a linha vira "10 dias antes · No aplicativo". (2) e (3) A edição fecha sem mudar nada.

**T-CA-06 (erro): alterar para uma antecedência já usada**
1. Altere a janela de 10 dias para `30`.

Esperado: a mensagem de antecedência já configurada aparece acima da tabela.

**T-CA-07: inativar e reativar**
1. Clique em **Inativar** na janela de 10 dias.
2. Clique em **Reativar**.

Esperado: (1) a linha fica esmaecida e mostra "Inativa". (2) Volta a mostrar "Ativa".

**T-CA-08 (erro): reativar com colisão**
1. Inative a janela de 10 dias.
2. Adicione uma nova janela com `10` dias. Ela é aceita, porque a outra está inativa.
3. Tente **Reativar** a janela antiga de 10 dias.

Esperado: a mensagem de antecedência já configurada aparece. Ao final, deixe **uma só** janela de
10 dias e inative a outra.

### 11.1 Notificações neste aparelho

Em produção, com as chaves VAPID configuradas (seção 3.2 de `docs/deploy.md`), o bloco
"Notificações neste aparelho" fica ativo.

**T-CA-09: estado inicial do aparelho**
1. Abra a tela em um aparelho que nunca ativou notificação.

Esperado: aparece "Este aparelho não recebe notificações. Sem elas, o alerta só aparece para quem
abrir o sistema." e o botão **Ativar notificações**.

> Se aparecer "Este servidor não está configurado para enviar notificações.", as chaves VAPID não
> foram configuradas no backend. Anote como falha de configuração e pule T-CA-11 a T-CA-13.

**T-CA-10: sem service worker**
1. Abra a tela em uma aba anônima, em que o service worker ainda não se registrou.

Esperado: "Instale o aplicativo (ou recarregue a página) para poder receber notificações neste
aparelho.". Recarregar a página resolve.

**T-CA-11: ativar notificações**
1. Clique em **Ativar notificações** e permita no diálogo do navegador.

Esperado: o botão mostra "Ativando…" e depois "Este aparelho recebe as notificações das janelas com
canal push ou ambos.", com o botão **Desativar notificações**.

**T-CA-12 (erro): permissão recusada no diálogo**
1. Em outro aparelho ou navegador limpo, clique em **Ativar notificações** e escolha **Bloquear**.

Esperado: "As notificações estão bloqueadas para este site. Libere nas configurações do navegador
e volte aqui.".

**T-CA-13: desativar**
1. Clique em **Desativar notificações**.

Esperado: o bloco volta para "Este aparelho não recebe notificações…" com o botão **Ativar
notificações**. Reative antes do T-AL-09, se for testar push.

**T-CA-14: navegador sem suporte**
1. Abra a tela em um navegador sem Web Push (ex.: Safari no iPhone sem o app adicionado à tela
   inicial).

Esperado: "Este navegador não oferece notificações. Os alertas continuam na aba Alertas.".

---

## 12. Alertas (gestor)

Pré-condição: janela de 30 dias ativa, com canal "No aplicativo", e as unidades `ZZ-DELTA` da
massa de dados (seção 3.1).

**Em produção a varredura não roda sozinha a qualquer hora.** Ela é disparada pelo cron da Vercel,
uma vez por dia, às 9h UTC (6h de Brasília, podendo sair dentro daquela hora). Para ver os alertas
durante o teste, há dois caminhos — os dois pedem terminal:

```bash
# A. chamando a mesma rota que o cron chama
curl -H "Authorization: Bearer <CRON_SECRET>" https://<api>.vercel.app/interno/varredura-alertas

# B. rodando a varredura direto contra o banco
cd backend && DATABASE_URL="<url-com-pooler>" npm run alertas:varrer
```

Depois de disparar, recarregue a página. O terceiro caminho é não disparar nada e conferir os
alertas **no dia seguinte** — é o que o T-AL-10 faz.

**T-AL-00: a rota do cron exige credencial**
1. Abra `https://<api>.vercel.app/interno/varredura-alertas` no navegador, sem o cabeçalho.

Esperado: resposta 401, com "Credencial de agendador inválida." (ou 503 "A varredura por agendador
externo não está configurada neste servidor.", se o `CRON_SECRET` não estiver definido — nesse
caso, o cron também não funciona, e isso é falha de configuração).

**T-AL-01: distintivo de não lidos**
1. Dispare a varredura e entre como gestor.

Esperado: a aba **Alertas** mostra um número. Com a janela de 30 dias, ele conta D1 (`HOJE+10`) e
D2 (`HOJE+25`), mais as unidades reais da loja que estiverem na janela.

**T-AL-02: lista**
1. Abra **Alertas**.

Esperado: aparece "N alerta(s) — N não lido(s) — página 1 de N". Cada alerta mostra produto,
etiqueta, validade, "Vence em N dias" e "Janela: avisado 30 dias antes". D3 (`HOJE+45`) **não**
aparece.

**T-AL-03: marcar como lido**
1. Clique em **Marcar como lido** no alerta de D1.

Esperado: o botão mostra "Marcando…" e depois vira o texto "Lido". O contador do resumo e o
distintivo da aba diminuem 1.

> Marcar como lido um alerta **real** da loja esconde um aviso que a gestora talvez ainda não tenha
> visto. Marque apenas os alertas dos produtos `ZZ-*`.

**T-AL-04: filtro de não lidos**
1. Marque **Mostrar só os não lidos**.
2. Marque como lido outro alerta de teste.

Esperado: (1) D1 some da lista. (2) O alerta sai da lista na hora. Se **todos** os alertas
estiverem lidos, aparece "Nenhum alerta não lido." e o distintivo da aba some.

**T-AL-05: janela maior pega mais unidades**
1. Em **Configurar alertas**, adicione uma janela de `60` dias e dispare a varredura de novo.

Esperado: D3 (`HOJE+45`) passa a ter alerta, mostrando "avisado 60 dias antes".

**T-AL-06: janela inativa não alerta**
1. Inative a janela de 60 dias, receba uma unidade nova de `ZZ-DELTA` com `HOJE+50` e dispare a
   varredura.

Esperado: nenhum alerta novo aparece para essa unidade.

**T-AL-07: varredura repetida não duplica**
1. Dispare a varredura duas vezes seguidas, sem cadastrar nada entre uma e outra.

Esperado: o número de alertas não muda. Nenhum alerta aparece duas vezes.

**T-AL-08: alerta de unidade que venceu depois do aviso**
1. Receba uma unidade `ZZ-DELTA` com validade **HOJE** e dispare a varredura. O alerta aparece com
   "Vence em 0 dias".
2. No dia seguinte, abra Alertas.

Esperado: o alerta aparece destacado como vencido, com "Vencida há 1 dia" e a nota "Esta unidade
venceu depois do aviso. O destino dela — descarte, correção de validade — está na fila de
descarte.". A unidade também aparece na Fila de descarte.

**T-AL-09: notificação push**
Pré-condição: T-CA-11 feito no aparelho e uma janela com canal "Notificação push" ou "No aplicativo
e push".
1. Receba uma unidade nova dentro dessa janela e dispare a varredura.

Esperado: o aparelho recebe **uma** notificação, mesmo com várias janelas ativas. Disparar a
varredura de novo, sem unidades novas, **não** notifica outra vez.

**T-AL-10: o cron roda sozinho (no dia seguinte)**
1. No dia seguinte aos testes, depois das 7h de Brasília, abra **Alertas**.
2. Confira na Vercel, no projeto do backend, a aba **Cron Jobs**.

Esperado: a execução do dia aparece com sucesso, e os alertas das unidades que entraram na janela
existem sem ninguém ter disparado nada. **É a única parte do sistema cuja falha não aparece como
erro:** se o cron não rodou, a tela apenas não tem nada de novo.

---

## 13. Dashboard (gestor)

> Os números incluem a operação real da loja. Para conferir o que **os testes** produziram, use o
> seletor de período com a janela anotada na regra 3 da seção 2.

**T-DB-01: carregamento padrão**
1. Abra **Dashboard**.

Esperado: os campos **De** e **Até** vêm preenchidos com os últimos 30 dias, terminando hoje. O
bloco **"Estoque agora"** mostra o total de unidades em estoque e as 5 faixas, nesta ordem: Já
vencidas, até 7 dias, 8 a 30 dias, 31 a 90 dias e mais de 90 dias. Faixas zeradas aparecem sem
barra.

**T-DB-02: os números de hoje batem com o que foi testado**
1. Coloque **De** e **Até** no dia de hoje e clique em **Aplicar período**.
2. Compare com o que foi executado nas seções 9 e 10.

Esperado (somando o que a loja fez hoje, se houve movimento real):
- **saída(s) registrada(s)**: todas as "Saída registrada" mais as vendas autorizadas.
- **acerto na primeira leitura (X de Y)**: o percentual calculado pelo servidor. Como houve
  override, aparece a nota "inclui N venda(s) autorizada(s) de unidade vencida, que não passaram
  pela validação de FIFO".
- **descarte(s) no período**: igual ao número de descartes feitos.
- **venda(s) de unidade vencida autorizada(s)**: 1 (T-LQ-19).
- **bloqueio(s) de FIFO vs. substituição(ões) efetiva(s)**: bloqueios ≥ 2 (T-LQ-01 e 02);
  substituições ≥ 1 (T-LQ-03).

**T-DB-03: link para a fila**
1. Clique em **resolver na fila de descarte**.

Esperado: abre a Fila de descarte.

**T-DB-04: histórico de saídas**
1. Role até **Histórico de saídas**.

Esperado: cada saída mostra produto, etiqueta, validade, data e hora local, atendente e "Tentativas
até o acerto". A saída do T-LQ-03 mostra **2 tentativas** e "Houve bloqueio de FIFO antes desta
venda". A venda do T-LQ-19 aparece destacada com "Venda de unidade vencida autorizada", a
justificativa entre aspas e "Autorizada por <nome do gestor>".

**T-DB-05: filtro de overrides**
1. Marque **Mostrar só as vendas autorizadas de unidade vencida**.

Esperado: só as vendas autorizadas aparecem, entre elas a do T-LQ-19.

**T-DB-06: período sem movimento**
1. Coloque De e Até em um período anterior à implantação do sistema e aplique.

Esperado: o título do bloco de período muda para as novas datas, os indicadores ficam zerados, a
taxa aparece como "—" com "sem saídas no período" e o histórico mostra "Nenhuma saída registrada no
período.". O bloco **Estoque agora não muda**.

**T-DB-07 (erro): período invertido**
1. Coloque De depois de Até e clique em **Aplicar período**.

Esperado: "A data inicial do período não pode ser posterior à data final.", no painel e no
histórico.

**T-DB-08: ponta vazia**
1. Apague o campo **De** e aplique.

Esperado: o servidor completa a data que falta e a tela mostra no título o intervalo que ele usou.

**T-DB-09: paginação do histórico**
1. Escolha um período com mais de 20 saídas e use **Próxima** e **Anterior**.

Esperado: a navegação funciona e o resumo mostra "página N de M".

---

## 14. Contas de acesso (gestor)

> Mexa apenas nas contas "TESTE …" criadas aqui. Desativar ou trocar a senha de uma conta real
> tranca uma pessoa que trabalha na loja.

**T-US-01: lista**
1. Abra **Contas de acesso**.

Esperado: aparecem as contas reais, e a linha de quem está logado mostra "(você)". Nessa linha o
seletor de papel fica desabilitado e, no lugar dos botões, aparece "Use “Minha senha” para trocar a
sua".

**T-US-02: criar conta**
1. Crie a conta Nome `TESTE Atendente`, E-mail `teste.atendente@estoque.local`, Papel Atendente e
   uma senha de 12 caracteres ou mais.
2. Crie também `TESTE Gestor`, `teste.gestor@estoque.local`, Papel Gestor, com senha própria.

Esperado: o formulário limpa e as duas contas aparecem como "Ativa". **Use essas contas nos testes
seguintes.**

**T-US-03 (erro): senha curta**
1. Crie uma conta com a senha `curta123`.

Esperado: "A senha precisa ter pelo menos 12 caracteres.".

**T-US-04 (erro): e-mail repetido**
1. Crie uma conta com o e-mail ` TESTE.ATENDENTE@estoque.local ` (maiúsculas e espaços).

Esperado: "Já existe uma conta com esse e-mail.".

**T-US-05 (erro): e-mail malformado ou campo vazio**

Esperado: o navegador impede o envio.

**T-US-06: nova conta entra**
1. Em outra janela, entre com `teste.atendente@estoque.local`.

Esperado: entra como Atendente, na tela Leitura de QR.

**T-US-07: trocar papel**
1. Mude o papel de TESTE Atendente para **Gestor** no seletor da linha.
2. Na janela dessa conta, saia e entre de novo.

Esperado: (1) a linha muda na hora. (2) A conta passa a ver as abas de gestor. Devolva o papel para
Atendente ao final.

> Comportamento a observar: enquanto a pessoa **não** sai e entra de novo, a sessão dela continua
> com o papel antigo (a sessão dura até 8 horas). Anote se isso for um problema para a loja.

**T-US-08: desativar**
1. Clique em **Desativar** na linha de TESTE Atendente.
2. Marque **Mostrar contas desativadas**.
3. Tente entrar com essa conta em outra janela.

Esperado: (1) a conta some da lista. (2) Ela aparece esmaecida como "Desativada". (3) Aparece
"E-mail ou senha incorretos.".

> Comportamento a observar: uma sessão dessa conta que **já estava aberta** antes da desativação
> continua funcionando até a pessoa sair ou a sessão expirar. Registre o que foi observado — é
> relevante para o caso de desligar alguém às pressas.

**T-US-09: reativar**
1. Clique em **Reativar** em TESTE Atendente e entre com ela.

Esperado: o login volta a funcionar.

**T-US-10: redefinir senha**
1. Clique em **Redefinir senha** em TESTE Atendente.
2. Digite uma senha nova de 12 caracteres ou mais e clique em **Salvar senha**.
3. Entre com a senha nova e depois tente a antiga.

Esperado: (1) abre "Redefinir senha de TESTE Atendente". (2) Aparece "Senha redefinida para TESTE
Atendente. Informe a pessoa.". (3) A senha nova entra. A antiga mostra "E-mail ou senha
incorretos.".

**T-US-11 (erro): redefinir com senha curta**
1. Em **Redefinir senha**, informe `123`.

Esperado: "A senha precisa ter pelo menos 12 caracteres.".

**T-US-12: cancelar redefinição**

Esperado: **Cancelar** fecha o formulário sem mudar nada.

**T-US-13: um gestor altera outro gestor, mas não a si mesmo**
1. Entre como `teste.gestor@estoque.local` na janela 2.
2. Nessa janela, em Contas de acesso, desative **TESTE Atendente** e reative em seguida.
3. Ainda na janela 2, olhe a linha "TESTE Gestor (você)".

Esperado: (2) as duas ações funcionam. (3) A linha da própria conta tem o seletor de papel
desabilitado e não tem botões. A recusa do servidor, "Você não pode alterar o próprio acesso por
aqui…", **não é alcançável pela interface** (ver seção 18).

---

## 15. Minha senha (os dois papéis)

Faça com a conta **TESTE Atendente**, não com uma conta real.

**T-MS-01 (erro): confirmação diferente**
1. Preencha a senha atual correta, Nova senha `novasenha1234` e Repetir `novasenha9999`.

Esperado: "A confirmação não corresponde à nova senha.". Nada é enviado.

**T-MS-02 (erro): senha atual errada**
1. Preencha a Senha atual `errada` e os dois campos novos iguais, com 12 caracteres ou mais.

Esperado: "Senha atual incorreta.".

**T-MS-03 (erro): nova senha curta**
1. Senha atual correta, com a nova e a confirmação `curta`.

Esperado: "A senha precisa ter pelo menos 12 caracteres.".

**T-MS-04: troca com sucesso**
1. Troque a senha da conta TESTE Atendente por outra válida.
2. Saia e entre com a senha nova. Depois tente a antiga.

Esperado: (1) aparece "Senha trocada. Ela vale a partir do próximo login." e os campos são limpos.
(2) A senha nova entra. A antiga mostra "E-mail ou senha incorretos.".

**T-MS-05: campo obrigatório**

Esperado: com qualquer campo vazio, o navegador impede o envio.

---

## 16. Aplicativo instalável (PWA)

**T-PW-01: instalar**
1. No celular, abra `https://<frontend>.vercel.app` e use "Adicionar à tela inicial" (Android:
   menu do Chrome; iPhone: botão Compartilhar no Safari). No computador, use "Instalar aplicativo"
   na barra de endereço.

Esperado: o app abre em janela própria, com nome e ícone do sistema, sem a barra de endereço do
navegador.

**T-PW-02: abrir sem rede**
1. Com o app já aberto uma vez, ligue o modo avião e abra de novo.

Esperado: a interface carrega. A tela de login ou de sessão mostra o aviso de falta de conexão e a
Leitura de QR mostra "Sem conexão com o servidor". Nada finge funcionar offline.

**T-PW-03: atualização do app**
1. Depois de um deploy novo do frontend, feche e reabra o app instalado.

Esperado: a versão nova aparece (pode exigir abrir duas vezes, porque o service worker atualiza em
segundo plano). Nenhuma tela quebra no meio do caminho.

---

## 17. Duas pessoas ao mesmo tempo

**T-CC-01: duas atendentes com a mesma unidade**
1. Reative `ZZ-EPS` e cadastre 1 unidade com validade `HOJE+365`.
2. Na janela 1 e na janela 2, digite o mesmo código e clique em **Ler código** o mais próximo
   possível do mesmo instante.

Esperado: uma janela mostra "Saída registrada" e a outra mostra "Unidade já baixada". **Nunca** as
duas confirmam.

**T-CC-02: veredito velho não vale**
1. Na janela 1, leia uma unidade `ZZ-ALFA` que dá bloqueio de FIFO e anote o código correto
   sugerido.
2. Na janela 2, leia e venda essa unidade correta.
3. Na janela 1, leia de novo a unidade que estava na mão.

Esperado: o sistema recalcula e aponta a **próxima** unidade correta, ou confirma se agora ela for
a de menor validade. Ele não usa o veredito anterior.

---

## 18. Casos que não dá para reproduzir pela interface

Estes tratamentos existem no servidor, mas a interface não deixa o usuário chegar até eles. Ficam
fora do roteiro manual e são cobertos pelos testes automatizados (Vitest):

| Situação | Por que não aparece na tela |
|---|---|
| 403 "Seu papel não permite esta ação." | A interface esconde as ações e rotas que o papel não alcança. Só aparece chamando a API direto |
| "Você não pode alterar o próprio acesso por aqui…" | A própria linha do gestor não tem botões e o seletor de papel fica desabilitado |
| "A conta usada pelo sistema não pode ser alterada." | A conta de sistema não aparece na lista de contas |
| "Não foi possível gerar códigos únicos para o lote." | Exige colisão de código aleatório entre 1 bilhão de combinações |
| "Produto não encontrado." / "Alerta não encontrado." / "Configuração de alerta não encontrada." | A tela só envia ids que ela mesma listou |
| Lote com mais de 50 linhas de validade | Possível pela tela, mas exige clicar 51 vezes em "Adicionar outra validade". O esperado é "Alguns campos do formulário não foram aceitos…" |
| "Erro interno no servidor. Tente novamente em instantes." | Exige falha inesperada no servidor. Em produção **não force este caso**: derrubar o banco para vê-lo afeta a loja |

---

## 19. Limpeza ao terminar

Os produtos de teste saem pelo script. O resto sai pela interface.

### 19.1 Remover os produtos `ZZ-` (terminal)

Faça **fora do horário de atendimento**. Enquanto o script roda, o `EventoLog` fica travado, e
as leituras de QR do balcão esperam por ele durante alguns segundos.

**1. Ver o que será apagado, sem apagar:**

```bash
cd backend
DATABASE_URL="<url-direta>" npm run ficticios:remover
```

Esperado: a primeira linha é o banco de produção. Depois vem a lista de produtos e, em seguida,
a contagem de unidades, saídas, descartes, alertas e eventos. Confira que **todos os produtos da
lista são de teste**: os cinco da massa, o `ZZ-OMEGA`, os `ZZ-IMP1` a `ZZ-IMP3` e os `ZZ-P*`, se o
T-PR-08 os criou. Se
aparecer algum produto que não é de teste, **pare**: ele seria apagado junto, com todo o seu
histórico.

**2. Apagar:**

```bash
DATABASE_URL="<url-direta>" npm run ficticios:remover -- --confirmar
```

Esperado: as mesmas contagens e a palavra `removidos.`. A remoção é tudo ou nada. Se ela falhar
no meio, nada é apagado, e a mensagem de erro diz isso.

**3. Conferir:**

```bash
DATABASE_URL="<url-direta>" npm run ficticios:remover
```

Esperado: `nenhum produto fictício neste banco`.

### 19.2 O resto, pela interface

| Passo | Como | Observação |
|---|---|---|
| 1. Inativar as janelas de alerta criadas nos testes | Configurar alertas → **Inativar** | Deixe ativa só a janela que a loja usa de verdade |
| 2. Desativar as contas `TESTE …` | Contas de acesso → **Desativar** | Contas não são excluídas, por decisão de projeto |
| 3. Desativar as notificações do aparelho de teste | Configurar alertas → **Desativar notificações** | Só se o aparelho não for ficar em uso na loja |
| 4. Tirar bloqueios do DevTools e liberar a câmera | F12 → Request blocking; cadeado da barra de endereço | Fácil de esquecer e vira "bug" no dia seguinte |
| 5. Anotar a janela dos testes | Folha de registro | Serve para localizar o que a limpeza não alcança |

### 19.3 Conferir que o teste saiu dos números

1. No **Catálogo de produtos**, marque **Mostrar produtos inativos** e busque por `ZZ`.
2. Abra **Fila de descarte** e **Alertas**.
3. No **Dashboard**, aplique o período da janela dos testes.

Esperado: (1) "Nenhum produto encontrado.". (2) Nenhuma unidade `ZZ-` na fila e nenhum alerta
`ZZ-`. (3) Saídas, descartes, vendas autorizadas, bloqueios de FIFO e o histórico de saídas
mostram só a operação real da loja nesse período. Se a loja não operou durante os testes, tudo
fica zerado.

**O que permanece:** as contas `TESTE …` (desativadas), as janelas de alerta de teste (inativas)
e, no `EventoLog`, as leituras de códigos que não existem (T-LQ-06). Nenhum deles entra nos
números do dashboard.

**Se o piloto ainda não começou** e você quiser o banco exatamente como estava, restaure o backup
da seção 2.3. Isso também desfaz o que a limpeza não alcança:

```bash
pg_restore --dbname="<url-direta>" --clean --if-exists backup-antes-dos-testes-aaaa-mm-dd.dump
```

---

## 20. Folha de registro

Preencha os dados da rodada e uma linha por teste executado.

| Campo | Valor |
|---|---|
| Testado por | |
| Janela dos testes | de ____/____ ____h até ____/____ ____h |
| Frontend / versão (commit) | |
| Aparelhos usados | |

| ID | Hora | Papel | Resultado (OK / Falha / Não executado) | Observação / print |
|---|---|---|---|---|
| T-PD-01 | | | | |
| … | | | | |

Ao encontrar uma falha, anote:
1. O ID do teste e o passo em que ela aconteceu.
2. O que era esperado e o que apareceu (texto exato ou print).
3. Navegador, aparelho e se foi pelo app instalado ou pelo navegador.
4. Hora aproximada — é o que permite achar a requisição nos logs da Vercel.
5. Se a falha se repete ao refazer o passo.
