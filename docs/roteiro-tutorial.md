# Tutorial de teste: três dias de uma perfumaria usando o sistema

Este roteiro conta uma história: uma perfumaria pequena começa a controlar o estoque pelo
sistema. Você vive essa história passo a passo. Cada ação dela é uma ação de verdade no sistema
publicado, e cada uma vem com o que deve aparecer na tela. No fim, você terá usado todas as
telas, nos dois papéis — gestora e atendente — e também os tropeços comuns de uma loja: senha
errada, frasco errado, etiqueta molhada, produto vencido, internet que cai.

São três dias de calendário, porque os avisos de vencimento são gerados uma vez por dia, de
madrugada:

| Dia | O que acontece | Tempo |
|---|---|---|
| Dia 1 | Implantação, recebimento, vendas no balcão, vencidos, balanço do dia | cerca de 2h30 |
| Dia 2 | Os avisos de vencimento chegam; a gestão das contas | cerca de 30 min |
| Dia 3 (opcional) | Um produto vence sem ser vendido | cerca de 10 min |

Ele complementa `docs/roteiro-testes-manuais.md`, que testa cada caso de erro isoladamente. Este
segue o uso normal da loja.

---

## Para quem organiza o teste

Faça estes passos antes de entregar o roteiro. Quem vai testar não precisa de terminal nem de
acesso ao banco.

1. **Backup.** O teste grava no banco de produção. Faça o backup da seção 6 de
   `docs/deploy.md`.
2. **Conta de gestora para o teste.** Em **Contas de acesso**, crie `TESTE Gestora Tutorial`,
   e-mail `tutorial.gestora@estoque.local`, papel Gestor. Se o e-mail já existir de uma rodada
   anterior, reative a conta e redefina a senha. Nunca entregue a conta real da gestora da loja.
3. **Janela de 30 dias.** Em **Configurar alertas**, confira que existe a janela "30 dias antes ·
   No aplicativo", ativa.
4. **Preencha a tabela de acesso** da seção "Antes de começar". A senha vai em separado, não
   escrita neste documento.
5. **Reserve a limpeza.** Tudo o que o teste cria tem código `ZZ-` e sai do banco pelo script
   descrito em "Encerrando o teste". Até lá, os produtos `TESTE …` aparecem no catálogo da loja
   e entram nos números do dashboard.

---

## Antes de começar

### O que você vai precisar

| Item | Para quê |
|---|---|
| Computador com Chrome ou Edge | O caixa da loja, onde trabalha a gestora |
| Celular (Android com Chrome, ou iPhone com Safari) | O balcão, onde trabalha a atendente: leitura de QR pela câmera e app instalado |
| Impressora, tesoura e fita ou cola (recomendado) | Imprimir as etiquetas e colá-las nos "frascos" |
| Uns 18 objetos pequenos (caixinhas, potes, tampas) — opcional | Os frascos da história. Sem eles, as etiquetas recortadas sobre a mesa bastam |

Sem celular, use uma **janela anônima** no computador (Ctrl+Shift+N) para a atendente, e pule os
passos de instalação e de câmera do celular. Sem impressora, deixe a folha de etiquetas aberta na
tela e digite os códigos.

### Endereço e acesso

| Item | Valor |
|---|---|
| Endereço do sistema | `https://______________________` |
| E-mail da conta de gestora | `tutorial.gestora@estoque.local` |
| Senha da conta de gestora | *(entregue em separado)* |

### Quatro regras, porque o sistema já é o da loja

1. **Nunca leia a etiqueta de um produto real da loja.** Uma leitura confirmada dá baixa de
   verdade no estoque. Leia só as etiquetas impressas neste roteiro.
2. **Todo produto que você criar tem código começando em `ZZ-`.** Os do roteiro já vêm assim. É
   por esse prefixo que o teste é apagado depois.
3. **Mexa só no que é do teste:** produtos e contas com nome começando em `TESTE`. A fila de
   descarte e os alertas também mostram itens reais da loja; deixe-os como estão.
4. **Se a loja já usa o sistema, faça o dia 1 fora do horário de atendimento.**

### Os dois papéis

| Papel | Onde | Conta |
|---|---|---|
| **Gestora** | No computador, janela normal do navegador | A conta de gestora da tabela acima |
| **Atendente** | No celular (ou na janela anônima) | A conta que a gestora cria no capítulo 2 |

Cada passo diz em qual dos dois você está.

### As datas

O roteiro escreve as datas a partir do primeiro dia de teste: `HOJE+60` é 60 dias depois do
dia 1, e `HOJE-10` é 10 dias antes. Preencha a tabela antes de começar, porque você vai
digitá-las várias vezes. Para calcular, pesquise no Google, por exemplo, "hoje + 60 dias".

| Data | Dia | | Data | Dia | | Data | Dia |
|---|---|---|---|---|---|---|---|
| `HOJE-30` | ___/___/_____ | | `HOJE+5` | ___/___/_____ | | `HOJE+90` | ___/___/_____ |
| `HOJE-15` | ___/___/_____ | | `HOJE+25` | ___/___/_____ | | `HOJE+100` | ___/___/_____ |
| `HOJE-10` | ___/___/_____ | | `HOJE+30` | ___/___/_____ | | `HOJE+180` | ___/___/_____ |
| `HOJE-3` | ___/___/_____ | | `HOJE+50` | ___/___/_____ | | `HOJE+200` | ___/___/_____ |
| `HOJE+1` | ___/___/_____ | | `HOJE+60` | ___/___/_____ | | `HOJE+240` | ___/___/_____ |

Se o dia 2 ou o dia 3 não forem os dias seguintes ao dia 1, as contagens de "Vence em" e
"Vencida há" mudam. O resto continua valendo.

### Como anotar

Cada passo tem caixas **[ ]** com o que deve aparecer. Marque as que conferirem. Quando algo for
diferente, tire um print e anote na **Folha de anotações**, no fim do roteiro: capítulo, passo,
hora aproximada, o que você esperava e o que apareceu. Textos entre aspas devem aparecer
exatamente assim. Onde aparece `…`, o trecho varia (uma data, um código, um nome).

---

## O elenco: os produtos e os frascos

**O catálogo** (entra no capítulo 4):

| Código | Nome | Marca | Papel na história |
|---|---|---|---|
| `ZZ-FLORAL` | TESTE Perfume Flor de Laranjeira 100 ml | Aurora Fragrâncias | A entrega com validades misturadas |
| `ZZ-SERUM` | TESTE Sérum Facial Vitamina C 30 ml | Vale Verde Dermo | A validade digitada errado, descoberta no balcão |
| `ZZ-BATOM` | TESTE Batom Cremoso Cereja | Ateliê das Cores | Os vencidos esquecidos na gaveta |
| `ZZ-HIDRAT` | TESTE Hidratante Corporal Karité | Lume Banho | A validade digitada errado, descoberta na fila |
| `ZZ-PROTETOR` | TESTE Protetor Solar Facial FPS 50 | Vale Verde Dermo | Os avisos de vencimento |
| `ZZ-SHAMPOO` | TESTE Shampoo Camomila | Lume Banho | O produto que saiu de linha |
| `ZZ-COLONIA` | TESTE Colônia Lavanda Fresca | Aurora Fragrâncias | O lançamento que ainda não chegou |

**Os frascos** (entram nos capítulos 5 e 6). O código `PRF-XXXXXX` é gerado pelo sistema no
recebimento. Copie-o para esta tabela, porque o roteiro se refere a cada frasco pelo apelido.

| Apelido | Produto | Validade cadastrada | Código | | Apelido | Produto | Validade cadastrada | Código |
|---|---|---|---|---|---|---|---|---|
| **F1** | Perfume | `HOJE+60` | `PRF-______` | | **B2** | Batom | `HOJE-3` | `PRF-______` |
| **F2** | Perfume | `HOJE+60` | `PRF-______` | | **B3** | Batom | `HOJE-30` | `PRF-______` |
| **F3** | Perfume | `HOJE+240` | `PRF-______` | | **B4** | Batom | `HOJE+180` | `PRF-______` |
| **F4** | Perfume | `HOJE+240` | `PRF-______` | | **H1** | Hidratante | `HOJE-15` ⚠️ | `PRF-______` |
| **F5** | Perfume | `HOJE+240` | `PRF-______` | | **H2** | Hidratante | `HOJE+100` | `PRF-______` |
| **S1** | Sérum | `HOJE-10` ⚠️ | `PRF-______` | | **P0** | Protetor | `HOJE+1` | `PRF-______` |
| **S2** | Sérum | `HOJE+90` | `PRF-______` | | **P1** | Protetor | `HOJE+5` | `PRF-______` |
| **S3** | Sérum | `HOJE+90` | `PRF-______` | | **P2** | Protetor | `HOJE+25` | `PRF-______` |
| **B1** | Batom | `HOJE-3` | `PRF-______` | | **P3** | Protetor | `HOJE+50` | `PRF-______` |

⚠️ S1 e H1 são **erros de digitação de propósito**. Na história, a embalagem de S1 diz
`HOJE+30` e a de H1 diz `HOJE+200`, mas a gestora digitou errado no cadastro. Cadastre com a
data errada mesmo: descobrir e corrigir esse erro faz parte do teste.

---

# Dia 1

## Capítulo 1 — A gestora abre o sistema

> **História.** Segunda-feira, 8h. A dona da perfumaria vai começar a usar o sistema hoje.
> Antes de abrir a loja, ela entra pelo computador do caixa.

**Computador — gestora**

1. Abra o endereço do sistema. Informe o e-mail da conta de gestora e uma senha **errada**, e
   clique em **Entrar**.
   - [ ] Aparece "E-mail ou senha incorretos.", e a tela continua no login.
2. Informe a senha certa e clique em **Entrar**.
   - [ ] Enquanto carrega, o botão mostra "Entrando…".
   - [ ] A tela abre em **Catálogo de produtos**. No topo aparece "TESTE Gestora Tutorial —
     Gestor" e o botão **Sair**.
   - [ ] As abas são: Leitura de QR, Catálogo de produtos, Fila de descarte, Registrar
     recebimento, Alertas, Configurar alertas, Dashboard, Contas de acesso, Minha senha e
     Etiquetas.
3. Aperte **F5**.
   - [ ] Aparece "Verificando sessão…" por um instante, e a sessão continua aberta na mesma tela.
4. Abra **Dashboard** e anote os números do bloco **Estoque agora**. Você vai compará-los no fim
   do dia.

| Estoque agora, antes do teste | Valor |
|---|---|
| unidade(s) em estoque | |
| Já vencidas | |
| Vencem em até 7 dias | |
| Vencem em 8 a 30 dias | |
| Vencem em 31 a 90 dias | |
| Vencem em mais de 90 dias | |

---

## Capítulo 2 — Contratando a atendente

> **História.** A loja contratou uma atendente temporária. A gestora cria a conta dela.

**Computador — gestora**

1. Abra **Contas de acesso**.
   - [ ] A linha da sua conta mostra "(você)". Nela o seletor de papel está desabilitado e, no
     lugar dos botões, aparece "Use “Minha senha” para trocar a sua".
2. Em **Criar conta**, preencha:
   - Nome: `TESTE Atendente Tutorial`
   - E-mail: `tutorial.atendente@estoque.local`
   - Papel: **Atendente**
   - Senha inicial: `senha123` (curta de propósito)

   Clique em **Criar conta**.
   - [ ] Aparece "A senha precisa ter pelo menos 12 caracteres.", e os campos continuam
     preenchidos.
3. Troque a senha inicial por `balcao-provisoria-01` e clique em **Criar conta**.
   - [ ] O formulário é limpo e a conta aparece na tabela com o papel "Atendente" e a situação
     "Ativa".

> Se aparecer "Já existe uma conta com esse e-mail.", o roteiro já foi feito antes neste
> sistema. Use `tutorial.atendente2@estoque.local` (ou o próximo número livre) daqui em diante.

---

## Capítulo 3 — O celular do balcão

> **História.** O celular do balcão vai ser o leitor de QR da loja. A atendente entra com a senha
> provisória, troca por uma só dela e instala o sistema como aplicativo.

**Celular — atendente**

1. No navegador do celular, abra o endereço do sistema e entre com
   `tutorial.atendente@estoque.local` e a senha `balcao-provisoria-01`.
   - [ ] A tela abre direto em **Leitura de QR**, e o topo mostra "TESTE Atendente Tutorial —
     Atendente".
   - [ ] Só aparecem três abas: **Leitura de QR**, **Catálogo de produtos** e **Minha senha**.
2. Por curiosidade, a atendente tenta abrir uma tela da gestora: na barra de endereço,
   acrescente `/dashboard` ao fim do endereço e abra.
   - [ ] O sistema volta para **Leitura de QR**.
3. Abra **Minha senha**. Em "Senha atual", digite `balcao-provisoria-01`. Em "Nova senha",
   digite `minha-senha-do-balcao`. Em "Repetir a nova senha", digite algo **diferente**. Clique em
   **Trocar senha**.
   - [ ] Aparece "A confirmação não corresponde à nova senha."
4. Corrija a repetição e clique em **Trocar senha**.
   - [ ] Aparece "Senha trocada. Ela vale a partir do próximo login.", e os campos são limpos.
5. Clique em **Sair** e entre de novo, agora com `minha-senha-do-balcao`.
   - [ ] A entrada funciona.
6. Instale o sistema como aplicativo:
   - **Android (Chrome):** menu ⋮ → **Instalar app** ou **Adicionar à tela inicial**.
   - **iPhone (Safari):** botão Compartilhar → **Adicionar à Tela de Início**.
7. Abra o sistema pelo ícone novo da tela inicial. Se pedir login, entre com a conta da
   atendente.
   - [ ] O app abre em janela própria, sem a barra de endereço do navegador, com o nome "Estoque
     FIFO".

Deixe o app aberto em **Leitura de QR**. Ele volta à cena no capítulo 4.

---

## Capítulo 4 — O catálogo da loja

> **História.** A gestora tem a lista de produtos numa planilha. Em vez de cadastrar um por um,
> ela importa a planilha. Na pressa, esquece de preencher o nome de um produto.

**Computador — gestora**

### 4.1 Preparar a planilha

1. Em **Catálogo de produtos**, na seção "Importar produtos de planilha", clique em **Baixar
   planilha modelo**.
   - [ ] Baixa o arquivo `modelo-produtos.csv`. Aberto no Excel, no LibreOffice ou no Google
     Planilhas, ele tem as colunas **código interno**, **nome**, **marca** e **categoria**, com
     os acentos certos.
2. Preencha o modelo com as linhas abaixo. **Deixe em branco o nome do `ZZ-PROTETOR`**: é o
   esquecimento da história. O primeiro código vai em minúsculas de propósito.

   | código interno | nome | marca | categoria |
   |---|---|---|---|
   | zz-floral | TESTE Perfume Flor de Laranjeira 100 ml | Aurora Fragrâncias | Perfumaria |
   | ZZ-SERUM | TESTE Sérum Facial Vitamina C 30 ml | Vale Verde Dermo | Cuidados com a pele |
   | ZZ-BATOM | TESTE Batom Cremoso Cereja | Ateliê das Cores | Maquiagem |
   | ZZ-HIDRAT | TESTE Hidratante Corporal Karité | Lume Banho | Corpo e banho |
   | ZZ-PROTETOR | *(em branco)* | Vale Verde Dermo | Cuidados com a pele |
   | ZZ-SHAMPOO | TESTE Shampoo Camomila | Lume Banho | Cabelos |

3. Salve como CSV. No Excel, o formato "CSV (separado por vírgulas)" serve. No Google Planilhas,
   use Arquivo → Fazer download → Valores separados por vírgula (.csv).

> **Sem programa de planilha?** Abra o Bloco de Notas, cole o texto abaixo e salve como
> `catalogo-tutorial.csv`:
>
> ```
> código interno;nome;marca;categoria
> zz-floral;TESTE Perfume Flor de Laranjeira 100 ml;Aurora Fragrâncias;Perfumaria
> ZZ-SERUM;TESTE Sérum Facial Vitamina C 30 ml;Vale Verde Dermo;Cuidados com a pele
> ZZ-BATOM;TESTE Batom Cremoso Cereja;Ateliê das Cores;Maquiagem
> ZZ-HIDRAT;TESTE Hidratante Corporal Karité;Lume Banho;Corpo e banho
> ZZ-PROTETOR;;Vale Verde Dermo;Cuidados com a pele
> ZZ-SHAMPOO;TESTE Shampoo Camomila;Lume Banho;Cabelos
> ```

### 4.2 Primeira tentativa, com o esquecimento

4. Em **Arquivo CSV**, escolha a planilha e clique em **Importar**.
   - [ ] Em vermelho: "A planilha tem problemas e nada foi importado. Corrija as linhas abaixo e
     envie de novo.", com a linha "Linha 6: nome em branco."
5. Em "Buscar por nome ou código", busque `ZZ-FLORAL`.
   - [ ] "Nenhum produto encontrado." Nem as linhas corretas entraram: ou a planilha entra
     inteira, ou não entra nada.

### 4.3 Segunda tentativa

6. Preencha o nome que faltou: `TESTE Protetor Solar Facial FPS 50`. Salve e importe de novo.
   - [ ] O botão mostra "Importando…" e, em seguida, aparece em verde "6 produto(s)
     importado(s).".
7. Busque `ZZ-`.
   - [ ] Os seis produtos aparecem, todos "Ativo". O código do perfume está em maiúsculas,
     `ZZ-FLORAL`, embora tenha sido digitado `zz-floral`.
   - [ ] Os acentos estão certos: Sérum, Fragrâncias, Ateliê, Karité.

   Podem aparecer outros produtos `ZZ-` de testes anteriores. Ignore-os.

### 4.4 Na dúvida, de novo

> A gestora não tem certeza de que a importação foi e manda a planilha outra vez.

8. Importe o mesmo arquivo de novo.
   - [ ] Aparece "0 produto(s) importado(s).", seguido de "6 código(s) já estavam cadastrados e
     foram pulados:" e da lista de "Linha 2: ZZ-FLORAL" até "Linha 7: ZZ-SHAMPOO". Nenhum produto
     foi duplicado.

### 4.5 Um lançamento fora da planilha

> A marca do perfume mandou um lançamento que não está na planilha. A gestora cadastra à mão e,
> no automático, digita o código do perfume que já existe.

9. Em **Cadastrar produto**, preencha: Código interno `zz-floral`, Nome `TESTE Colônia Lavanda
   Fresca`, Marca `Aurora Fragrâncias`, Categoria `Perfumaria`. Clique em **Cadastrar**.
   - [ ] "Já existe um produto com esse código interno.", e os campos continuam preenchidos.
10. Troque o código para `zz-colonia` e clique em **Cadastrar**.
    - [ ] O botão mostra "Cadastrando…". O formulário é limpo e a colônia aparece na tabela como
      `ZZ-COLONIA`, "Ativo".

### 4.6 Procurar produtos

11. Busque `hidratante`, em minúsculas.
    - [ ] O TESTE Hidratante Corporal Karité aparece. Hidratantes reais da loja podem aparecer
      junto.
12. Busque `serum`, sem acento.
    - [ ] Anote o resultado. Hoje a busca diferencia acentos, então o esperado é que o Sérum do
      teste **não** apareça. Se isso fosse atrapalhar na loja, registre na folha.
13. Busque `ZZ-SERUM`.
    - [ ] O Sérum aparece: a busca também funciona pelo código.

### 4.7 Um produto saiu de linha

14. Busque `ZZ-` de novo. Na linha do `ZZ-SHAMPOO`, clique em **Inativar**.
    - [ ] O shampoo some da lista.
15. Marque **Mostrar produtos inativos**.
    - [ ] O shampoo volta, com a linha esmaecida e a situação "Inativo".
16. Por engano, clique em **Inativar** na linha da `ZZ-COLONIA`. Ela continua na tela, como
    "Inativo", porque os inativos estão sendo mostrados. Clique em **Reativar** na mesma linha.
    - [ ] A colônia volta a "Ativo". O shampoo continua "Inativo".
17. Desmarque **Mostrar produtos inativos**, apague o campo de busca e clique em **Buscar**.
    - [ ] O catálogo inteiro aparece. Se ele tiver mais de 20 produtos, o título mostra "página 1
      de N": **Próxima** leva à página 2, e **Anterior** fica desabilitado na página 1.

### 4.8 A atendente consulta o catálogo

> Uma cliente pergunta se a loja tem protetor solar. A atendente consulta pelo celular.

**Celular — atendente**

18. Abra **Catálogo de produtos** e busque `protetor`.
    - [ ] O TESTE Protetor Solar Facial FPS 50 aparece.
    - [ ] Não aparecem o formulário "Cadastrar produto", a seção "Importar produtos de planilha"
      nem a coluna **Ações**. A atendente só consulta.

---

## Capítulo 5 — Chegou a entrega do perfume: validades misturadas

> **História.** A distribuidora entregou uma caixa com 5 frascos do Perfume Flor de Laranjeira.
> Ao abrir a caixa, a gestora percebe que eles **não são todos iguais**: 2 vieram de um lote
> antigo, que vence em dois meses, e 3 de um lote novo, que vence em oito. Por fora, os cinco
> frascos são idênticos. É exatamente o caso que o controle manual não resolve.

**Computador — gestora**

1. Abra **Registrar recebimento**.
2. Em "Buscar produto por nome ou código", digite `ZZ-FLORAL` e clique em **Buscar**. No seletor
   **Produto**, escolha `ZZ-FLORAL — TESTE Perfume Flor de Laranjeira 100 ml (Aurora
   Fragrâncias)`.

   > Com o catálogo real da loja, o seletor mostra só os primeiros produtos ("Mostrando 20 de N
   > produtos. Refine a busca para achar os demais."). Por isso a busca vem antes.

3. Na primeira linha, preencha Validade `HOJE+60` e Unidades `2`.
4. Clique em **Adicionar outra validade** e preencha `HOJE+240` e `3`.
5. Clique em **Adicionar outra validade** mais uma vez, por engano. Na linha nova, vazia, clique
   em **Remover**.
   - [ ] A linha extra some, e as duas preenchidas continuam.
   - [ ] O resumo mostra "Total: 5 unidade(s) neste recebimento."
6. Clique em **Registrar recebimento**.
   - [ ] Aparece "5 unidade(s) cadastrada(s)" e uma tabela com 5 códigos `PRF-XXXXXX`, a
     validade de cada um e a situação "Em estoque".
   - [ ] O formulário volta a ter uma linha só.
7. **Copie os códigos para a tabela de frascos.** Os dois de `HOJE+60` são **F1** e **F2**. Os
   três de `HOJE+240` são **F3**, **F4** e **F5**.

### Imprimir as etiquetas

8. Clique em **Imprimir etiquetas destas unidades**.
   - [ ] Abre a tela **Etiquetas** com "TESTE Perfume Flor de Laranjeira 100 ml — 5 unidade(s)
     do recebimento" e 5 etiquetas. Cada uma tem o QR, o código em texto e "Val dd/mm/aaaa".
   - [ ] A folha está em ordem de validade: primeiro as duas de `HOJE+60`.
9. Em "Tamanho do símbolo", alterne entre 15 mm, 20 mm e 25 mm.
   - [ ] O QR muda de tamanho, e o rodapé diz "símbolo de N mm". Deixe em 20 mm.
10. Aperte **F5**.
    - [ ] A mesma folha continua na tela.
11. Clique em **Imprimir**. Imprima, ou salve como PDF para imprimir depois.
    - [ ] Na pré-visualização aparecem só as etiquetas e o rodapé, sem menu, abas nem botões.
12. Recorte as etiquetas e cole cada uma num objeto pequeno. Escreva o apelido (F1, F2…) no
    objeto, com caneta. Agrupe os frascos de cada produto, como numa prateleira.

> **Atenção com a câmera:** ela lê qualquer QR que entrar no quadro. Recorte as etiquetas
> separadas, ou cubra as vizinhas, para não ler o frasco errado sem querer.
>
> **Sem impressora?** Deixe a folha aberta no computador. Na hora de ler, digite o código ou
> aponte a câmera do celular para a tela.

---

## Capítulo 6 — O estoque que já estava na loja

> **História.** Além da entrega nova, a loja já tinha produtos na prateleira e na gaveta. Para o
> sistema valer, a gestora cadastra também esse estoque antigo, frasco por frasco, conferindo a
> validade de cada um. A contagem traz surpresas: batons esquecidos que já venceram. E dois
> erros de digitação passam despercebidos — eles serão descobertos mais tarde.

**Computador — gestora**

Para cada produto abaixo: abra **Registrar recebimento**, busque o código, escolha o produto,
preencha as linhas e clique em **Registrar recebimento**. Copie os códigos para a tabela de
frascos. Depois clique em **Imprimir etiquetas destas unidades**, imprima, recorte e cole.

### 6.1 Sérum

Linhas: `HOJE-10` × 1 e `HOJE+90` × 2. A data `HOJE-10` é o erro de digitação de propósito.

- [ ] Aparece "3 unidade(s) cadastrada(s)" e, em vermelho, "1 unidade(s) foram cadastradas já
  vencidas (validade aaaa-mm-dd). Elas entram em estoque e serão barradas na venda." Nessa
  mensagem a data aparece com o ano primeiro.
- Apelidos: `HOJE-10` → **S1**. `HOJE+90` → **S2** e **S3**.

### 6.2 Batom

Linhas: `HOJE-3` × 2, `HOJE-30` × 1 e `HOJE+180` × 1.

- [ ] 4 unidades cadastradas, com **dois** avisos vermelhos: um para as 2 unidades de `HOJE-3` e
  outro para a de `HOJE-30`.
- Apelidos: `HOJE-3` → **B1** e **B2** (tanto faz qual é qual). `HOJE-30` → **B3**. `HOJE+180` →
  **B4**.

### 6.3 Hidratante

Linhas: `HOJE-15` × 1 e `HOJE+100` × 1. A data `HOJE-15` é o segundo erro de propósito.

- [ ] 2 unidades cadastradas e 1 aviso vermelho.
- Apelidos: `HOJE-15` → **H1**. `HOJE+100` → **H2**.

### 6.4 Protetor solar

Quatro linhas de 1 unidade: `HOJE+1`, `HOJE+5`, `HOJE+25` e `HOJE+50`.

- [ ] 4 unidades cadastradas e nenhum aviso.
- Apelidos, na ordem das datas: **P0**, **P1**, **P2** e **P3**.

### 6.5 O shampoo que saiu de linha

1. Em **Registrar recebimento**, busque `ZZ-SHAMPOO`.
   - [ ] Aparece "Nenhum produto ativo encontrado. Cadastre-o antes em Catálogo de produtos." Um
     produto inativo não recebe mercadoria.
   - [ ] Sem produto escolhido, o botão **Registrar recebimento** fica desabilitado.

---

## Capítulo 7 — Uma etiqueta rasgou

> **História.** Ao colar as etiquetas, uma do sérum rasgou. A gestora vai reimprimir.

**Computador — gestora**

1. Abra a aba **Etiquetas**.
   - [ ] Aparece o seletor de produto, sem nenhuma etiqueta carregada sozinha.
   - [ ] Sem produto escolhido, **Carregar etiquetas** fica desabilitado.
2. Busque `ZZ-SERUM`, escolha o Sérum e clique em **Carregar etiquetas**.
   - [ ] Aparece "TESTE Sérum Facial Vitamina C 30 ml — todas as unidades em estoque", com 3
     etiquetas em ordem de validade: S1, S2, S3. Não precisa imprimir de novo.
3. Clique em **Escolher outro produto**, busque `ZZ-COLONIA`, escolha a colônia e carregue.
   - [ ] Aparece "Nenhuma unidade em estoque para etiquetar neste produto." O lançamento ainda não
     chegou.

---

## Capítulo 8 — A loja abre: o balcão

> **História.** 10h, a loja abre. A atendente fica no balcão com o celular, e a gestora no caixa,
> com o computador. Todo frasco que sai da loja é lido antes. O sistema responde se aquele é o
> frasco que deve sair primeiro.

**Como ler um frasco.** Na tela **Leitura de QR**, digite o código no campo "Ou digite o código
impresso na etiqueta" e clique em **Ler código**. Nas cenas 1 a 4, **digite**: a câmera é testada
de propósito na cena 5, e digitar garante que nenhum frasco vizinho seja lido sem querer. Os
números do balanço do dia (capítulo 12) dependem disso.

### Cena 1 — O frasco da frente da prateleira

> Uma cliente quer o Perfume Flor de Laranjeira. A atendente pega o frasco mais à mão, que é do
> lote novo.

**Celular — atendente**

1. Leia **F3**.
   - [ ] Aparece o bloco **"Não é esta unidade"**, com "Devolva esta unidade à prateleira
     (validade …). Saia primeiro com a de validade … — código PRF-…".
   - [ ] O código em destaque, grande, é o de **F1 ou F2**. Em "Na sua mão" aparece F3, e em
     "Saia com esta", o frasco indicado.
   - [ ] Embaixo: "Tentativa 1 neste produto. O contador é do servidor."
   - [ ] O campo de código foi limpo.
2. A atendente pega outro frasco do lote novo. Leia **F4**.
   - [ ] Outro bloqueio, agora com "Tentativa 2 neste produto."
3. A atendente vai à prateleira e pega um frasco do lote antigo, mas **não** o que a tela
   indicou: se a tela mostrou F1, leia **F2**; se mostrou F2, leia **F1**.
   - [ ] Aparece **"Saída registrada"**, com "Saída registrada: TESTE Perfume Flor de Laranjeira
     100 ml (Aurora Fragrâncias), validade …". O sistema aceita qualquer frasco da validade mais
     antiga, não um frasco específico.
4. O frasco de `HOJE+60` que ficou na prateleira, o que a tela tinha indicado, passa a se chamar
   **F-sobra**. Anote qual é.
5. Clique em **Encerrar atendimento**.
   - [ ] O resultado some. O texto "Atendimento em andamento. As saídas desta sequência ficam
     agrupadas no relatório." continua: começou o atendimento do próximo cliente.

### Cena 2 — Duas vendas ao mesmo tempo

> Chega outro cliente pedindo o mesmo perfume, e a atendente pega de novo um frasco do lote novo.
> Enquanto ela vai buscar o frasco certo, a gestora, no caixa, vende justamente esse frasco a um
> terceiro cliente.

1. **Celular — atendente:** leia **F3**.
   - [ ] Bloqueio, indicando a **F-sobra**, com "Tentativa 1 neste produto." O contador recomeçou
     depois da venda da cena 1.
2. **Computador — gestora:** abra **Leitura de QR** e leia a **F-sobra**.
   - [ ] "Saída registrada".
3. **Celular — atendente:** com F3 ainda na mão, leia **F3** de novo.
   - [ ] Agora aparece **"Saída registrada"**. O sistema não usou a resposta anterior: refez a
     conta com o estoque daquele instante. Com a F-sobra vendida, F3 passou a ser um dos frascos
     mais antigos.
4. Clique em **Encerrar atendimento**, no celular e no computador.

### Cena 3 — Etiqueta molhada

> O frasco F4 pegou água e a etiqueta borrou. A atendente digita o código do jeito que consegue
> ler.

**Celular — atendente**

1. Digite o código de **F4** em minúsculas, com espaços no meio e nas pontas. Onde houver o
   número `0`, digite a letra `o`. Onde houver o número `1`, digite a letra `i` ou `l`. Exemplo:
   `PRF-1K0Q7M` vira ` prf-ik oq7m `.
2. Clique em **Ler código**.
   - [ ] "Saída registrada", direto. O sistema reconheceu o código, e F4 já é um dos frascos mais
     antigos.

### Cena 4 — Leitura repetida e código errado

**Celular — atendente**

1. Sem lembrar se já leu, a atendente lê **F4** outra vez.
   - [ ] Aparece **"Unidade já baixada"**, com "Esta unidade já saiu do estoque — foi vendida ou
     descartada. Leia outra unidade." e "Código lido: PRF-…".
2. Clique em **Ler outra unidade**.
   - [ ] O resultado some.
3. Digite `PRF-ZZZZZZ`, um código que não existe, e clique em **Ler código**.
   - [ ] Aparece **"Código não encontrado"**, com "Código não cadastrado. Confira a etiqueta ou
     digite o código impresso abaixo do QR."
4. Apague o campo.
   - [ ] Com o campo vazio, **Ler código** fica desabilitado.
5. Clique em **Encerrar atendimento**.

### Cena 5 — Pela câmera

**Celular — atendente**

1. Clique em **Ligar câmera** e permita o acesso.
   - [ ] A imagem da câmera aparece na tela.
2. Aponte para a etiqueta de **F5** e mantenha parado por uns 5 segundos.
   - [ ] O veredito aparece sozinho, sem tocar na tela: "Saída registrada". Mesmo com a etiqueta
     parada na frente da câmera, a venda é registrada **uma vez só**. Isso é conferido no
     capítulo 12.
3. Sem tocar na tela, aponte para a etiqueta de **F1**, que já foi vendido.
   - [ ] "Unidade já baixada" aparece sozinho. Não é preciso clicar em "Ler outra unidade" entre
     um frasco e outro.
4. Clique em **Desligar câmera**.
   - [ ] A imagem some e volta o botão **Ligar câmera**.
5. Clique em **Encerrar atendimento**.

> Se a câmera não abrir, anote a mensagem que apareceu (por exemplo, "Permissão de câmera negada.
> Libere a câmera nas configurações do navegador ou digite o código abaixo.") e leia F5
> digitando o código.

### Cena 6 — A internet caiu

**Celular — atendente**

1. Com a **Leitura de QR** aberta, ligue o **modo avião**.
   - [ ] A tela troca para **"Sem conexão com o servidor"**, explicando que a leitura de QR não
     funciona offline, com o botão **Tentar de novo**. O campo de código e a câmera somem.
2. Ainda no modo avião, toque em **Tentar de novo**.
   - [ ] A tela continua bloqueada.
3. Desligue o modo avião e espere alguns segundos. Se nada mudar, toque em **Tentar de novo**.
   - [ ] A tela de leitura volta, vazia.

> Na janela anônima do computador, a queda se simula assim: F12 → aba **Network** → troque "No
> throttling" por **Offline**. Para voltar, escolha "No throttling" de novo.

---

## Capítulo 9 — Frascos vencidos no balcão

### Cena 7 — O batom da gaveta

> Uma cliente pede o batom cereja. A atendente pega um dos que estavam na gaveta.

**Celular — atendente**

1. Leia **B1**.
   - [ ] Aparece **"Unidade vencida"**, com "TESTE Batom Cremoso Cereja (Ateliê das Cores) venceu
     em …. Esta unidade não sai pelo fluxo normal."
   - [ ] Em "O que fazer com esta unidade" aparece **só** o caminho "A unidade está vencida
     mesmo", com o campo "Motivo (opcional)" e o botão **Registrar descarte**.
   - [ ] Aparece também "Corrigir a validade cadastrada e autorizar a venda de unidade vencida são
     ações do gestor."
2. A atendente confere a embalagem: está vencido mesmo. Deixe o motivo em branco e clique em
   **Registrar descarte**.
   - [ ] Aparece **"Descarte registrado"**, com "Descarte registrado: TESTE Batom Cremoso Cereja
     (Ateliê das Cores), validade …. A unidade saiu do estoque e entra no relatório de perdas."
3. Clique em **Ler outra unidade** e leia **B4**, o batom de `HOJE+180`.
   - [ ] "Saída registrada", direto. B2 e B3 continuam no estoque e são mais antigos, mas estão
     vencidos: o sistema não manda vender um frasco vencido primeiro.
4. Clique em **Encerrar atendimento**.

### Cena 8 — O sérum que parecia vencido

> Outro cliente quer o sérum. A atendente pega S1, e o sistema diz que ele venceu há 10 dias. Mas
> a embalagem diz `HOJE+30`: alguém digitou a validade errada no cadastro. A atendente não pode
> corrigir, então chama a gestora.

1. **Celular — atendente:** leia **S1**.
   - [ ] "Unidade vencida", com a validade `HOJE-10`.
2. A atendente **não** descarta. Toque em **Ler outra unidade**.
3. **Computador — gestora:** em **Leitura de QR**, leia **S1**.
   - [ ] Aparecem três caminhos, nesta ordem: **"A validade está errada no cadastro"**, com o
     campo "Validade impressa na embalagem" já preenchido com a data cadastrada e o botão
     **Corrigir validade**; **"A unidade está vencida mesmo"**, com o descarte; e, por último, o
     botão discreto **Autorizar a venda mesmo assim**.
4. Clique em **Corrigir validade** sem mudar a data.
   - [ ] "A validade informada é igual à que já está cadastrada. Não há o que corrigir."
5. Mude a data para `HOJE+30` e clique em **Corrigir validade**.
   - [ ] Aparece **"Saída registrada"**, com a validade nova. O sistema refez a conta da ordem de
     saída com a data corrigida: S1 passou a ser o sérum mais antigo, antes de S2 e S3
     (`HOJE+90`), e a venda já ficou registrada. O cliente leva S1.
6. Clique em **Encerrar atendimento**.

### Cena 9 — A cliente que insiste

> Uma cliente vê o batom vencido e quer levá-lo assim mesmo. A gestora decide autorizar. Na vida
> real, vender produto vencido é vedado pelo Código de Defesa do Consumidor. O sistema permite
> como exceção, sempre registrada, e é essa exceção que se testa aqui.

**Computador — gestora**

1. Leia **B2**.
   - [ ] "Unidade vencida", com os três caminhos.
2. Clique em **Autorizar a venda mesmo assim**.
   - [ ] Abre "Autorizar a venda desta unidade vencida", com o aviso: "A venda de produto com
     validade expirada é vedada pela legislação de defesa do consumidor. Esta autorização fica
     registrada de forma permanente, com seu nome."
3. Na justificativa, digite `teste`.
   - [ ] Aparece "Faltam 5 caracteres para a justificativa.", e o botão **Autorizar venda** fica
     desabilitado.
4. Clique em **Cancelar**.
   - [ ] O formulário fecha, e volta o botão **Autorizar a venda mesmo assim**.
5. Abra de novo, escreva `TESTE do tutorial: cliente ciente do vencimento` e clique em
   **Autorizar venda**.
   - [ ] Aparece **"Venda autorizada"**, com "Venda de unidade vencida autorizada por TESTE
     Gestora Tutorial: TESTE Batom Cremoso Cereja (Ateliê das Cores), validade …. O registro
     desta autorização é permanente."
6. Clique em **Encerrar atendimento**.

---

## Capítulo 10 — Fim do expediente: a fila de descarte

> **História.** 18h. Antes de fechar, a gestora confere o que já venceu e continua na loja. São
> frascos que ninguém pediu, e por isso nunca passariam pelo balcão.

**Computador — gestora**

A fila mostra **todas** as unidades vencidas do estoque, inclusive as reais da loja. Resolva só
as do teste.

1. Abra **Fila de descarte**.
   - [ ] Aparece "N unidade(s) vencida(s) em estoque — página 1 de N", da mais antiga para a mais
     recente.
   - [ ] Entre elas estão o batom **B3** ("Vencida há 30 dias") e o hidratante **H1** ("Vencida
     há 15 dias"). Cada item mostra nome, marca, código interno, etiqueta e validade.
   - [ ] **Não** aparecem B1 (descartado), B2 (vendido com autorização) nem S1 (corrigido).
2. Clique em **Resolver** no B3. Depois, clique em **Resolver** no H1.
   - [ ] Só um painel fica aberto por vez.
   - [ ] O painel tem **Corrigir validade** e **Registrar descarte**, mas não tem "Autorizar a
     venda mesmo assim": na fila não há cliente comprando.
3. Abra de novo o painel do **B3**, escreva o motivo `Esquecido no fundo da gaveta` e clique em
   **Registrar descarte**.
   - [ ] Aparece uma nota verde, "Descarte registrado: …". B3 sai da lista e o total diminui 1.
4. A gestora pega o frasco H1 e lê na embalagem `HOJE+200`: é o segundo erro de digitação. Abra o
   painel do **H1**, mude a data para `HOJE+200` e clique em **Corrigir validade**.
   - [ ] A lista recarrega e H1 sai dela.
   - [ ] Aparece uma nota **vermelha**: "Devolva esta unidade à prateleira (validade …). Saia
     primeiro com a de validade … — código PRF-…", com o código de **H2**. Não é falha: com a data
     certa, H1 não está vencido e volta para a prateleira. O sistema já avisa que, na hora de
     vender, H2 (`HOJE+100`) sai antes.

---

## Capítulo 11 — Os avisos de vencimento

> **História.** A gestora quer saber com antecedência quando um frasco está perto de vencer, para
> fazer promoção antes da perda. A loja já tem um aviso com 30 dias de antecedência. Ela quer um
> segundo, de última chamada, 7 dias antes, que chegue também como notificação.

**Computador — gestora**

1. Abra **Configurar alertas**.
   - [ ] A tabela "Janelas configuradas, da mais larga para a mais estreita" mostra pelo menos
     "30 dias antes", "No aplicativo", "Ativa".
   - [ ] O formulário vem preenchido com 30 dias e "No aplicativo".

   > Se não houver janela de 30 dias, adicione uma (30, "No aplicativo") e pule o passo 2.

2. Sem mudar nada, clique em **Adicionar janela**.
   - [ ] "Já existe uma configuração ativa com essa antecedência. Altere a existente em vez de
     criar uma segunda."
3. Mude para `7` dias, com "No aplicativo", e clique em **Adicionar janela**.
   - [ ] A linha "7 dias antes", "No aplicativo", "Ativa" aparece abaixo da de 30.

   > Se já existir uma janela de 7 dias, use 6 ou 8. O resto do roteiro continua valendo.

4. Na linha de 7 dias, clique em **Alterar**, troque "Como avisar" para **No aplicativo e push**
   e clique em **Salvar**.
   - [ ] A linha passa a mostrar "No aplicativo e push".

### Notificações neste aparelho

A notificação chega só aos aparelhos em que um **gestor** a ativou. O celular está com a conta
da atendente, então ative no computador. Se tiver um segundo celular, pode ativar nele, entrando
como gestora.

5. Confira o bloco "Notificações neste aparelho".
   - [ ] Aparece "Este aparelho não recebe notificações. Sem elas, o alerta só aparece para quem
     abrir o sistema." e o botão **Ativar notificações**.

   > Se aparecer "Instale o aplicativo (ou recarregue a página) para poder receber notificações
   > neste aparelho.", recarregue a página. Se aparecer "Este servidor não está configurado para
   > enviar notificações.", anote na folha (é configuração do servidor) e pule para o capítulo 12.

6. Clique em **Ativar notificações** e permita no aviso do navegador.
   - [ ] O botão mostra "Ativando…" e depois aparece "Este aparelho recebe as notificações das
     janelas com canal push ou ambos.", com o botão **Desativar notificações**.

A verificação de vencimentos roda sozinha, uma vez por dia, entre 6h e 7h (horário de Brasília).
Os avisos destes frascos aparecem amanhã, no dia 2.

---

## Capítulo 12 — O balanço do dia

> **História.** Loja fechada. A gestora confere o que o sistema registrou hoje.

**Computador — gestora**

1. Abra **Dashboard**.
   - [ ] Os campos **De** e **Até** vêm preenchidos com os últimos 30 dias, terminando hoje.
2. Coloque **De** e **Até** na data de hoje e clique em **Aplicar período**.
   - [ ] O título do bloco do período passa a ser "No período — dd/mm/aaaa a dd/mm/aaaa", com a
     data de hoje nas duas pontas.

**Os números do período.** Se a loja não teve movimento real hoje, os números são exatamente os
da tabela. Se teve, aparecem somados aos da loja, e a conferência fina é pelo histórico (passo 4).

| Indicador | Esperado | De onde vem |
|---|---|---|
| saída(s) registrada(s) | **8** | Cena 1, F-sobra e F3 (cena 2), F4 (cena 3), F5 (cena 5), B4 (cena 7), S1 (cena 8), B2 (cena 9) |
| acerto na primeira leitura | **75,0%** (6 de 8) | Só duas vendas tiveram bloqueio antes: a da cena 1 e o F3 da cena 2 |
| nota sob a taxa | "inclui 1 venda(s) autorizada(s) de unidade vencida, que não passaram pela validação de FIFO" | Cena 9 |
| descarte(s) no período | **2** | B1 (cena 7) e B3 (fila) |
| venda(s) de unidade vencida autorizada(s) | **1** | B2 (cena 9) |
| bloqueio(s) de FIFO | **4** | F3 e F4 (cena 1), F3 (cena 2) e a correção do H1 na fila |
| substituição(ões) efetiva(s) | **2** | A venda da cena 1 e o F3 da cena 2 |

- [ ] Os números conferem.

> Duas coisas para observar e anotar, se parecerem estranhas. A correção do H1 na fila conta como
> "bloqueio de FIFO", embora ninguém estivesse vendendo. E o F3 da cena 2 conta como
> "substituição efetiva", embora a atendente tenha vendido o mesmo frasco que foi bloqueado: quem
> mudou foi o estoque, não o frasco na mão dela.

3. **Estoque agora.** Compare com o que você anotou no capítulo 1. Este bloco é uma fotografia do
   momento e não muda com o período escolhido.

   | Faixa | Diferença esperada | Frascos do teste |
   |---|---|---|
   | unidade(s) em estoque | +8 | |
   | Já vencidas | 0 | Todos os vencidos do teste foram resolvidos |
   | Vencem em até 7 dias | +2 | P0, P1 |
   | Vencem em 8 a 30 dias | +1 | P2 |
   | Vencem em 31 a 90 dias | +3 | S2, S3, P3 |
   | Vencem em mais de 90 dias | +2 | H1 (já corrigido), H2 |

   - [ ] As diferenças conferem. Faixas zeradas aparecem sem barra.
4. Role até **Histórico de saídas**.
   - [ ] Aparece "N saída(s) no período", a mais recente primeiro. Cada saída mostra produto,
     etiqueta, validade, data e hora, atendente e "Tentativas até o acerto".
   - [ ] O **B2** aparece destacado, com "Venda de unidade vencida autorizada", a justificativa
     entre aspas e "Autorizada por TESTE Gestora Tutorial".
   - [ ] A venda da **cena 1** mostra Tentativas até o acerto **2**, "Houve bloqueio de FIFO antes
     desta venda" e a atendente TESTE Atendente Tutorial.
   - [ ] O **F3** (cena 2) mostra Tentativas **1**, com a mesma marca de bloqueio.
   - [ ] A **F-sobra** mostra a gestora como atendente, com Tentativas **0**.
   - [ ] O **F5** (câmera) aparece **uma vez só**.
5. Marque **Mostrar só as vendas autorizadas de unidade vencida**.
   - [ ] Só aparece a venda do B2, mais vendas autorizadas reais, se houver.
6. Coloque em **De** uma data **posterior** à de **Até** e clique em **Aplicar período**.
   - [ ] Aparece "A data inicial do período não pode ser posterior à data final."
7. No bloco **Estoque agora**, clique em **resolver na fila de descarte**.
   - [ ] Abre a **Fila de descarte**.
8. Clique em **Sair**, no computador e no celular. Depois, use o botão Voltar do navegador do
   computador.
   - [ ] Os dois voltam à tela de login, e o Voltar não reabre o sistema.

Fim do dia 1.

---

# Dia 2

Faça a partir das **7h** do dia seguinte. A verificação automática roda entre 6h e 7h.

## Capítulo 13 — Os avisos chegaram

> **História.** Terça de manhã. Antes de abrir a loja, a gestora recebe um aviso: há frascos
> perto de vencer.

**No aparelho onde as notificações foram ativadas (capítulo 11)**

1. Confira as notificações do aparelho. No computador, ela pode aparecer só depois de você abrir
   o navegador.
   - [ ] Chegou uma notificação "N unidades perto do vencimento", com "Janela de 7 dias. Toque
     para ver a lista." N é pelo menos 2 (P0 e P1). Pode ser maior se a loja tiver produtos reais
     vencendo nos próximos 7 dias, e o texto pode citar outras janelas, se houver outras com
     notificação.
2. Toque ou clique na notificação.
   - [ ] O sistema abre em **Alertas**. Antes, pode pedir login: entre como gestora.

**Computador — gestora**

3. Confira a aba **Alertas** na barra de abas.
   - [ ] Ela mostra um número: a quantidade de alertas não lidos.
4. Abra **Alertas**.
   - [ ] Aparece "N alerta(s) — N não lido(s) — página 1 de N".
   - [ ] Para os frascos do teste, os alertas são estes. Cada um mostra produto, etiqueta,
     validade, "Vence em" e "Janela":

     | Frasco | Vence em | Alertas |
     |---|---|---|
     | P0 | 0 dias | Dois: "avisado 30 dias antes" e "avisado 7 dias antes" |
     | P1 | 4 dias | Dois: 30 e 7 dias antes |
     | P2 | 24 dias | Um: 30 dias antes |

   - [ ] **P3** (`HOJE+50`) não tem alerta: está fora das duas janelas.
5. A gestora decide pôr o protetor P1 em promoção. Isso é feito fora do sistema. Clique em
   **Marcar como lido** nos dois alertas do P1.
   - [ ] O botão mostra "Marcando…" e vira o texto "Lido". O número de não lidos diminui no resumo
     e na aba.
6. Marque **Mostrar só os não lidos**.
   - [ ] Os alertas do P1 saem da lista.

---

## Capítulo 14 — A atendente esqueceu a senha

> **História.** A atendente chega e não lembra a senha nova.

1. **Celular — atendente:** tente entrar com uma senha qualquer.
   - [ ] "E-mail ou senha incorretos."
2. **Computador — gestora:** em **Contas de acesso**, clique em **Redefinir senha** na linha
   TESTE Atendente Tutorial.
   - [ ] Abre "Redefinir senha de TESTE Atendente Tutorial".
3. Em "Nova senha", digite `123` e clique em **Salvar senha**.
   - [ ] "A senha precisa ter pelo menos 12 caracteres."
4. Digite `nova-senha-do-balcao` e clique em **Salvar senha**.
   - [ ] Aparece "Senha redefinida para TESTE Atendente Tutorial. Informe a pessoa."
5. **Celular — atendente:** tente a senha antiga, `minha-senha-do-balcao`. Depois, a nova.
   - [ ] A antiga é recusada com "E-mail ou senha incorretos." A nova entra.

---

## Capítulo 15 — A atendente cobre a folga da gestora

> **História.** A gestora vai folgar na quinta, e a atendente vai precisar receber mercadoria.
> Por um dia, a gestora dá a ela o papel de gestora.

1. **Computador — gestora:** em **Contas de acesso**, no seletor de papel da linha TESTE Atendente
   Tutorial, escolha **Gestor**.
   - [ ] A linha muda na hora.
2. **Celular — atendente:** observe as abas. O app ainda mostra três, porque a sessão aberta
   mantém o papel antigo. Clique em **Sair** e entre de novo.
   - [ ] O topo mostra "— Gestor", e aparecem todas as abas.

   > Se isto for um problema para a loja, anote: até sair e entrar de novo, ou até a sessão
   > expirar (em até 8 horas), a pessoa continua com o papel antigo.

3. **Computador — gestora:** volte o papel para **Atendente**. **Celular:** saia e entre de novo.
   - [ ] Voltam as três abas da atendente.

---

## Capítulo 16 — Férias

> **História.** A atendente temporária sai de férias. A gestora desliga a conta dela, sem apagar
> nada do que ela fez.

1. **Celular — atendente:** clique em **Sair**.
2. **Computador — gestora:** em **Contas de acesso**, clique em **Desativar** na linha da
   atendente.
   - [ ] A conta some da lista.
3. Marque **Mostrar contas desativadas**.
   - [ ] A conta aparece esmaecida, como "Desativada".
4. **Celular — atendente:** tente entrar.
   - [ ] "E-mail ou senha incorretos."
5. **Computador — gestora:** em **Dashboard**, aplique o período do dia 1 (De e Até na data do
   dia 1).
   - [ ] As vendas que a atendente fez no dia 1 continuam no histórico, com o nome dela.
6. As férias acabaram. Em **Contas de acesso**, com "Mostrar contas desativadas" marcado, clique
   em **Reativar** na linha da atendente.
   - [ ] A conta volta a "Ativa", e o login dela, no celular, volta a funcionar.

Fim do dia 2. Se não for fazer o dia 3, vá para "Encerrando o teste".

---

# Dia 3 (opcional)

## Capítulo 17 — O protetor que não vendeu

> **História.** O protetor P0 vencia no dia 2, e ninguém o vendeu.

**Computador — gestora**

1. Abra **Alertas**. Se o filtro "Mostrar só os não lidos" estiver marcado, desmarque.
   - [ ] Os dois alertas do P0 aparecem destacados como vencidos, com "Vencida há 1 dia" e a nota
     "Esta unidade venceu depois do aviso. O destino dela — descarte, correção de validade — está
     na fila de descarte."
2. Abra **Fila de descarte**.
   - [ ] O P0 está na fila, "Vencida há 1 dia".
3. Clique em **Resolver** no P0, escreva o motivo `Venceu antes de ser vendido` e clique em
   **Registrar descarte**.
   - [ ] Nota verde, e o P0 sai da fila.
4. Volte a **Alertas**.
   - [ ] Os alertas do P0 sumiram: a lista mostra só alertas de unidades que ainda estão no
     estoque.
5. Em **Dashboard**, aplique o período do dia 1 até hoje.
   - [ ] descarte(s) no período: **3** (B1, B3 e P0), mais os descartes reais da loja, se houver.

---

# Encerrando o teste

**Você, pela interface:**

1. **Configurar alertas:** na janela de 7 dias, clique em **Inativar**. Não mexa na de 30 dias.
   - [ ] A linha fica esmaecida e mostra "Inativa".
2. **Configurar alertas**, no aparelho em que você ativou as notificações: clique em **Desativar
   notificações**.
   - [ ] O bloco volta a "Este aparelho não recebe notificações…", com o botão **Ativar
     notificações**.
3. **Contas de acesso:** clique em **Desativar** na linha TESTE Atendente Tutorial. Contas não são
   excluídas no sistema, só desativadas.
4. No celular, remova o app da tela inicial, se quiser.
5. Entregue a **Folha de anotações** a quem organizou o teste e avise que terminou.

**Quem organizou o teste, pelo terminal** (roteiro completo na seção 7.1 de `docs/deploy.md`):

```bash
cd backend
DATABASE_URL="<url-direta>" npm run ficticios:remover                  # só mostra o que apagaria
DATABASE_URL="<url-direta>" npm run ficticios:remover -- --confirmar   # apaga
```

Antes de confirmar, confira que a lista tem só produtos de teste: `ZZ-FLORAL`, `ZZ-SERUM`,
`ZZ-BATOM`, `ZZ-HIDRAT`, `ZZ-PROTETOR`, `ZZ-SHAMPOO` e `ZZ-COLONIA`, e outros `ZZ-` de rodadas
anteriores, se houver. Faça fora do horário de atendimento. Depois, desative a conta TESTE
Gestora Tutorial em **Contas de acesso**.

Ficam no banco, sem entrar em nenhum número do dashboard: as duas contas `TESTE …`
(desativadas), a janela de 7 dias (inativa) e o registro da leitura de `PRF-ZZZZZZ`, que não
aponta para produto nenhum.

---

## Atalho: ver os avisos sem esperar o dia seguinte

Para quem tem acesso ao terminal. Depois do capítulo 11, dispare a verificação de vencimentos na
hora, por um destes dois caminhos:

```bash
# A. pela mesma rota que o agendador diário chama
curl -H "Authorization: Bearer <CRON_SECRET>" https://<api>/interno/varredura-alertas

# B. direto contra o banco
cd backend && DATABASE_URL="<url-com-pooler>" npm run alertas:varrer
```

O capítulo 13 pode então ser feito no próprio dia 1, com uma diferença: os "Vence em" ficam um
dia maiores (P0: 1 dia, P1: 5 dias, P2: 25 dias). O capítulo 17 continua precisando de dois dias.

---

## Folha de anotações

| Campo | Valor |
|---|---|
| Testado por | |
| Datas do dia 1, dia 2 e dia 3 | |
| Computador e navegador | |
| Celular e sistema (Android/iPhone, versão) | |
| Usou impressora? Usou o app instalado? | |

| Capítulo / cena | Passo | Hora | O que era esperado | O que apareceu | Print? |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

Ao encontrar um problema:

1. Anote o capítulo e o passo.
2. Anote o que era esperado e o que apareceu, com o texto exato ou um print.
3. Anote em qual aparelho foi, e se foi no app instalado ou no navegador.
4. Anote a hora aproximada. Com ela, dá para achar a requisição nos registros do servidor.
5. Refaça o passo, se der, e anote se o problema se repete.

Além dos problemas, anote também o que pareceu confuso, demorado ou estranho para quem trabalha
numa loja, mesmo que o sistema tenha feito o que o roteiro esperava.

---

## O que este roteiro cobre

| Funcionalidade | Onde |
|---|---|
| Login, senha errada, sessão que sobrevive ao F5, sair | Cap. 1, 3, 12 |
| Abas por papel; atendente barrada nas telas da gestora | Cap. 1, 3 |
| Contas: criar, senha curta, e-mail repetido | Cap. 2 |
| Contas: redefinir senha, trocar papel, desativar e reativar | Cap. 14, 15, 16 |
| Minha senha | Cap. 3 |
| App instalado (PWA) | Cap. 3 |
| Catálogo: importar planilha (modelo, erro, sucesso, reenvio) | Cap. 4 |
| Catálogo: cadastro manual, código repetido, busca, inativar e reativar, paginação, visão da atendente | Cap. 4 |
| Recebimento: várias validades, remover linha, total, aviso de vencida, produto inativo fora da lista | Cap. 5, 6 |
| Etiquetas: folha do recebimento, tamanhos, impressão, F5, reimpressão, produto sem unidades | Cap. 5, 7 |
| Leitura: bloqueio de FIFO e tentativas, validade empatada, substituição, venda simultânea, digitação tolerante, unidade já baixada, código inexistente, encerrar atendimento | Cap. 8 |
| Câmera | Cap. 8, cena 5 |
| Sem conexão | Cap. 8, cena 6 |
| Vencido no balcão: descarte pela atendente; correção e venda autorizada pela gestora | Cap. 9 |
| Fila de descarte: descarte e correção de validade | Cap. 10, 17 |
| Configurar alertas: janela repetida, adicionar, alterar, inativar | Cap. 11 e encerramento |
| Notificações: ativar, receber, desativar | Cap. 11, 13 e encerramento |
| Alertas: lista, número na aba, marcar como lido, filtro, vencida depois do aviso | Cap. 13, 17 |
| Dashboard: estoque agora, período, indicadores, histórico, filtro, período inválido | Cap. 1, 12, 16, 17 |

Ficam para `docs/roteiro-testes-manuais.md` os casos que o uso normal de uma loja raramente
provoca: excesso de tentativas de login, sessão expirada no meio do uso, servidor fora do ar com
internet funcionando, recebimento acima de 500 unidades, paginação da folha de etiquetas, colisão
entre janelas de alerta e duas pessoas lendo o mesmo frasco no mesmo segundo.
