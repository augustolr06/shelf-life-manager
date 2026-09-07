import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// RNF: o schema mora em src/db/schema.prisma (docs/arquitetura.md seção 2),
// não no caminho padrão prisma/schema.prisma.
export default defineConfig({
  schema: 'src/db/schema.prisma',
})
