-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ATENDENTE', 'GESTOR');

-- CreateEnum
CREATE TYPE "StatusUnidade" AS ENUM ('EM_ESTOQUE', 'VENDIDA', 'DESCARTADA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "codigoInterno" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadeProduto" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "codigoQr" TEXT NOT NULL,
    "dataValidade" DATE NOT NULL,
    "status" "StatusUnidade" NOT NULL DEFAULT 'EM_ESTOQUE',
    "dataEntrada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registradoPorId" TEXT NOT NULL,

    CONSTRAINT "UnidadeProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Saida" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alertaFifoDisparado" BOOLEAN NOT NULL DEFAULT false,
    "tentativasAteAcerto" INTEGER NOT NULL DEFAULT 0,
    "vendaDeUnidadeVencida" BOOLEAN NOT NULL DEFAULT false,
    "justificativaOverride" TEXT,
    "autorizadoPorId" TEXT,
    "sessaoVendaId" TEXT,

    CONSTRAINT "Saida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Descarte" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT NOT NULL,

    CONSTRAINT "Descarte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoAlerta" (
    "id" TEXT NOT NULL,
    "diasAntecedencia" INTEGER NOT NULL,
    "canal" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ConfiguracaoAlerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alerta" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "configuracaoId" TEXT NOT NULL,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lidoEm" TIMESTAMP(3),

    CONSTRAINT "Alerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoLog" (
    "id" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "unidadeId" TEXT,
    "produtoId" TEXT,
    "usuarioId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_codigoInterno_key" ON "Produto"("codigoInterno");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadeProduto_codigoQr_key" ON "UnidadeProduto"("codigoQr");

-- CreateIndex
CREATE INDEX "UnidadeProduto_produtoId_status_dataValidade_idx" ON "UnidadeProduto"("produtoId", "status", "dataValidade");

-- CreateIndex
CREATE UNIQUE INDEX "Saida_unidadeId_key" ON "Saida"("unidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "Descarte_unidadeId_key" ON "Descarte"("unidadeId");

-- AddForeignKey
ALTER TABLE "UnidadeProduto" ADD CONSTRAINT "UnidadeProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Saida" ADD CONSTRAINT "Saida_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "UnidadeProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Saida" ADD CONSTRAINT "Saida_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Descarte" ADD CONSTRAINT "Descarte_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "UnidadeProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Descarte" ADD CONSTRAINT "Descarte_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_configuracaoId_fkey" FOREIGN KEY ("configuracaoId") REFERENCES "ConfiguracaoAlerta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoLog" ADD CONSTRAINT "EventoLog_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
