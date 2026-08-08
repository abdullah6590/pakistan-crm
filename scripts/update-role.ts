import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.user.updateMany({
    where: { email: 'vendor1@example.com' },
    data: { role: 'ADMIN' }
  });
  console.log('Role updated to ADMIN');
}
main().catch(console.error).finally(() => prisma.$disconnect());
