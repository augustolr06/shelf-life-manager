# T24 — Importação do catálogo de produtos por planilha CSV (RF02)

**Depende de:** T04 (CRUD de produto e a tela de Catálogo)
**Incremento:** 8 (Carga do catálogo real)
**Bloqueia:** nada em código. Destrava a **carga inicial** do catálogo real da perfumaria
(~700 SKUs), que hoje só entraria digitando produto por produto

## Objetivo

O gestor da loja já tem o catálogo numa planilha. Cadastrar 700 SKUs um a um pelo formulário
de T04 é o tipo de trabalho que faz uma loja pequena desistir do sistema antes de começar a
usá-lo. Esta tarefa deixa a gestora enviar essa planilha, salva como CSV, pela tela de
Catálogo, e o sistema cadastra todos os produtos de uma vez.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **Importa produtos, não unidades.** A planilha traz o catálogo: código, nome, marca e
   categoria. As unidades físicas continuam entrando pelo Recebimento (T05). Cada unidade
   precisa de uma etiqueta colada no frasco, e a validade de uma unidade precisa ser lida no
   frasco. Uma planilha de validades é justamente o controle manual que o sistema substitui.
2. **Na tela de Catálogo, não na de Recebimento.** Recebimento é a chegada de unidades
   físicas; o que se importa aqui é catálogo.
3. **Toda a validação é do servidor.** O navegador só lê o arquivo, converte para texto e o
   envia como está. Quem interpreta o CSV, valida cada linha e decide o que cadastrar é o
   backend, pelo mesmo motivo da RNF04: a tela reflete o que o servidor respondeu.
4. **Planilha com erro não grava nada.** A resposta lista cada problema com o número da linha,
   e a gestora corrige no Excel e envia de novo. Gravar as linhas boas e recusar as ruins
   deixaria a gestora sem saber o que já entrou.
5. **Código já cadastrado é pulado e avisado, não atualizado.** Decisão do orientando
   (2026-09-22). Atualizar sobrescreveria o que a gestora já ajustou no sistema, e recusar a
   planilha inteira a impediria de reenviar uma planilha que já entrou em parte.
6. **Código repetido dentro da mesma planilha é erro.** Não há como saber qual das duas linhas
   é a certa.
7. **Colunas pelo nome, não pela posição, e colunas extras ignoradas.** O cabeçalho é comparado
   sem acento, sem maiúsculas e sem espaço: `Código interno`, `codigo_interno` e
   `codigoInterno` são a mesma coluna. Assim a planilha do gestor pode manter colunas que o
   sistema não usa (preço, fornecedor) sem precisar ser recortada.
8. **Sem novo tipo de `EventoLog`.** O cadastro de produto pelo formulário também não gera
   evento. O log registra o que acontece com o **estoque**, e um SKU sem unidade não é estoque.

## Critério de aceite

### Backend

- [x] `src/shared/csv.ts`: leitura de CSV reaproveitada pela importação e pela planilha de
      fictícios. Separador `;` ou `,`, BOM, aspas, CRLF
- [x] `POST /produtos/importar`, papel `GESTOR`, corpo `{ conteudo: string }`
- [x] Sucesso: 200 `{ criados, ignorados: [{ linha, codigoInterno }] }`
- [x] Planilha com problema: 400 `PLANILHA_INVALIDA`, com `erros: string[]` (cada um com o
      número da linha) e nada gravado
- [x] Mesma normalização do cadastro manual (`codigoInterno` em maiúsculas, texto aparado) e o
      mesmo limite de 120 caracteres por campo
- [x] Teto de linhas por planilha, com folga sobre a escala da RNF10
- [x] Testes com banco real: cadastro, código existente pulado, planilha com erro sem escrita,
      código repetido na planilha, colunas pelo nome e extras ignoradas, 403 para ATENDENTE

### Frontend

- [x] Seção "Importar produtos de planilha" na tela de Catálogo, só para GESTOR
- [x] O arquivo é lido como UTF-8; se não for UTF-8 válido, como Windows-1252, que é o que o
      Excel em português grava no "CSV (separado por vírgulas)"
- [x] Link para baixar um modelo com o cabeçalho
- [x] Resultado: quantos entraram, quais códigos foram pulados, ou a lista de erros
- [x] A lista do catálogo recarrega depois de uma importação
- [x] Testes de componente em Vitest + Testing Library, e conferência no navegador com o
      `playwright-cli`

### Fechamento

- [x] `docs/arquitetura.md`, seção 5: rota nova
- [x] `docs/decisoes.md` com as decisões acima; `docs/notas-para-artigo.md` com a Decisão 1
- [x] `docs/roteiro-testes-manuais.md`: testes da importação

## Achados durante a implementação

**O Excel em português não grava UTF-8 por padrão.** O "CSV (separado por vírgulas)" sai em
Windows-1252, e lido como UTF-8 os acentos viram `�` e entram assim no catálogo. O navegador
tenta UTF-8 estrito e, se falhar, relê como Windows-1252. Conferido no navegador com um arquivo
gravado nesse encoding: "Perfume Clássico" e "Marca Ação" chegaram inteiros.

**O limite de corpo do Fastify recusaria a planilha grande antes da rota.** O padrão é 1 MiB. A
rota ganhou `bodyLimit` de 4 MiB, abaixo do limite da Vercel. O teste de 5.000 linhas passa de
1 MiB de propósito; retirado o limite, ele falha, o que foi conferido.

**A leitura de CSV já existia, na planilha de produtos fictícios.** Ela foi movida para
`shared/csv.ts` e agora serve às duas planilhas.

## Fora de escopo desta tarefa

- **Importar unidades com validade** — Decisão 1
- **Atualizar produtos existentes pela planilha** — Decisão 5
- **Arquivo `.xlsx`.** Exigiria dependência nova para ler o formato; o Excel salva CSV
- **Pré-visualização das linhas antes de confirmar.** A validação do servidor já recusa a
  planilha inteira em caso de erro, e o resultado lista o que foi pulado
