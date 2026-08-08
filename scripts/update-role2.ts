import { prisma } from '../src/lib/prisma';

async function main() {
  await prisma.user.updateMany({
    where: { email: 'vendor1@example.com' },
    data: { role: 'ADMIN' }
  });
  console.log('Role updated to ADMIN');
}

main().catch(console.error).finally(() => process.exit(0));
