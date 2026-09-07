import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// RNF: o schema mora em src/db/schema.prisma (docs/arquitetura.md seção 2),
// não no caminho padrão prisma/schema.prisma.
export default defineConfig({
  schema: 'src/db/schema.prisma',
  migrations: {
    // Declarado aqui, e não na chave "prisma" do package.json, que está
    // depreciada no Prisma 6 e removida no 7.
    seed: 'tsx src/db/seed.ts',
  },
})
