-- DropForeignKey
ALTER TABLE "Saida" DROP CONSTRAINT "Saida_autorizadoPorId_fkey";

-- AddForeignKey
ALTER TABLE "Saida" ADD CONSTRAINT "Saida_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
