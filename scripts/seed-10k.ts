import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Starting DB seed for performance testing...");

  // Create a default category
  const category = await prisma.componentCategory.upsert({
    where: { name: 'Test Category' },
    update: {},
    create: {
      name: 'Test Category',
      color: '#ff0000',
    },
  });

  console.log("Created category:", category.id);

  // Generate 5,000 components
  console.log("Generating 5,000 components...");
  const componentsData = Array.from({ length: 5000 }).map((_, i) => ({
    sku: `TEST-COMP-${i}-${Date.now()}`,
    name: `Test Component ${i}`,
    categoryId: category.id,
    quantity: Math.floor(Math.random() * 100),
    minQuantity: 10,
    unitCost: Math.random() * 50,
    unitPrice: Math.random() * 100,
    isActive: true,
  }));

  // Prisma doesn't support massive createMany in SQLite well, so we chunk it
  const chunkSize = 500;
  for (let i = 0; i < componentsData.length; i += chunkSize) {
    const chunk = componentsData.slice(i, i + chunkSize);
    await prisma.component.createMany({
      data: chunk,
    });
    console.log(`Inserted components ${i} to ${i + chunk.length}`);
  }

  // Generate 2,000 customers
  console.log("Generating 2,000 customers...");
  const customersData = Array.from({ length: 2000 }).map((_, i) => ({
    name: `Test Customer ${i}`,
    phone: `+92${Math.floor(Math.random() * 1000000000)}`,
  }));

  for (let i = 0; i < customersData.length; i += chunkSize) {
    const chunk = customersData.slice(i, i + chunkSize);
    await prisma.customer.createMany({
      data: chunk,
    });
    console.log(`Inserted customers ${i} to ${i + chunk.length}`);
  }

  console.log("Seeding complete! You can now test the pagination and dashboard performance.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
