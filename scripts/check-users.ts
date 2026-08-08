import { prisma } from '../src/lib/prisma';

async function main() {
  const users = await prisma.user.findMany();
  console.log('ALL USERS IN DB:', JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
