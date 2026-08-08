import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

// Parse arguments
const args = process.argv.slice(2);
const countArg = args.find(a => a.startsWith('--count='));
const RECORD_COUNT = countArg ? parseInt(countArg.split('=')[1], 10) : 1000;

console.log(`\n======================================================`);
console.log(`STARTING STRESS TEST: ${RECORD_COUNT} TARGET RECORDS`);
console.log(`======================================================\n`);

// Ensure we are using the test database
process.env.DATABASE_URL = 'file:./test.db';

// Import AFTER setting process.env so it uses test.db
import { prisma } from '../src/lib/prisma';

async function runSeed() {
  console.log(`[1] Seeding Phase...`);
  
  // Calculate relative sizes for realistic distribution
  const numCustomers = Math.max(10, Math.floor(RECORD_COUNT * 0.1));
  const numSuppliers = Math.max(5, Math.floor(RECORD_COUNT * 0.05));
  const numProducts = Math.max(50, Math.floor(RECORD_COUNT * 0.2));
  const numSales = Math.max(100, Math.floor(RECORD_COUNT * 0.4));
  const numPurchases = Math.max(50, Math.floor(RECORD_COUNT * 0.15));
  const numFinances = Math.max(100, Math.floor(RECORD_COUNT * 0.1));
  
  const CHUNK_SIZE = 2000;

  // Create a default category
  let category = await prisma.componentCategory.findFirst({ where: { name: 'Scale Test Category' } });
  if (!category) {
    category = await prisma.componentCategory.create({ data: { name: 'Scale Test Category', color: '#000000' } });
  }

  // Create a dummy user
  let user = await prisma.user.findFirst({ where: { email: 'stress@test.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Stress Test User',
        email: 'stress@test.local',
        password: 'dummy',
        role: 'ADMIN',
      }
    });
  }

  // 1. Customers
  console.log(`    Seeding ${numCustomers} customers...`);
  const cData = Array.from({ length: numCustomers }).map((_, i) => ({
    name: `Customer ${i} ${Date.now()}`,
    phone: `+92300${i.toString().padStart(7, '0')}`,
    isActive: true,
  }));
  for (let i = 0; i < cData.length; i += CHUNK_SIZE) {
    await prisma.customer.createMany({ data: cData.slice(i, i + CHUNK_SIZE) });
  }
  const customers = await prisma.customer.findMany({ select: { id: true } });

  // 2. Suppliers
  console.log(`    Seeding ${numSuppliers} suppliers...`);
  const sData = Array.from({ length: numSuppliers }).map((_, i) => ({
    name: `Supplier ${i} ${Date.now()}`,
    phone: `+92311${i.toString().padStart(7, '0')}`,
    isActive: true,
  }));
  for (let i = 0; i < sData.length; i += CHUNK_SIZE) {
    await prisma.supplier.createMany({ data: sData.slice(i, i + CHUNK_SIZE) });
  }
  const suppliers = await prisma.supplier.findMany({ select: { id: true } });

  // 3. Products/Components
  console.log(`    Seeding ${numProducts} products...`);
  const pData = Array.from({ length: numProducts }).map((_, i) => ({
    sku: `SKU-${Date.now()}-${i}`,
    name: `Product ${i}`,
    categoryId: category!.id,
    supplierId: suppliers[i % suppliers.length].id,
    quantity: Math.floor(Math.random() * 500),
    minQuantity: 10,
    unitCost: 10 + (Math.random() * 90),
    unitPrice: 150 + (Math.random() * 50),
    isActive: true,
    totalSold: Math.floor(Math.random() * 1000),
  }));
  for (let i = 0; i < pData.length; i += CHUNK_SIZE) {
    await prisma.component.createMany({ data: pData.slice(i, i + CHUNK_SIZE) });
  }
  const products = await prisma.component.findMany({ select: { id: true, unitCost: true, unitPrice: true } });

  // 4. Sales and Sale Items
  console.log(`    Seeding ${numSales} sales...`);
  const now = Date.now();
  for (let i = 0; i < numSales; i += CHUNK_SIZE) {
    const chunk = Math.min(CHUNK_SIZE, numSales - i);
    const salesData = Array.from({ length: chunk }).map((_, j) => {
      const idx = i + j;
      const custId = idx % 2 === 0 ? customers[idx % customers.length].id : null;
      return {
        invoiceNumber: `INV-${now}-${idx}`,
        customerId: custId,
        walkInName: custId ? null : `WalkIn ${idx}`,
        total: 0,
        profit: 0,
        paymentMethod: 'CASH',
        paymentStatus: 'PAID' as const,
        createdAt: new Date(now - (Math.random() * 10000000000)),
        userId: user!.id,
      };
    });
    await prisma.sale.createMany({ data: salesData });
  }
  
  // Create sale items (doing this in batches to avoid locking)
  console.log(`    Seeding sale items...`);
  const createdSales = await prisma.sale.findMany({ select: { id: true } });
  let saleItemBatch = [];
  for (let i = 0; i < createdSales.length; i++) {
    const numItems = 1 + Math.floor(Math.random() * 4); // 1 to 4 items per sale
    for (let j = 0; j < numItems; j++) {
      const p = products[(i + j) % products.length];
      const qty = 1 + Math.floor(Math.random() * 5);
      saleItemBatch.push({
        saleId: createdSales[i].id,
        componentId: p.id,
        quantity: qty,
        unitPrice: p.unitPrice,
        unitCost: p.unitCost,
        totalPrice: qty * p.unitPrice,
        totalCost: qty * p.unitCost,
        profit: (qty * p.unitPrice) - (qty * p.unitCost),
      });
    }
    if (saleItemBatch.length >= CHUNK_SIZE) {
      await prisma.saleItem.createMany({ data: saleItemBatch });
      saleItemBatch = [];
    }
  }
  if (saleItemBatch.length > 0) {
    await prisma.saleItem.createMany({ data: saleItemBatch });
  }

  // 5. Finances
  console.log(`    Seeding ${numFinances} finances...`);
  const fData = Array.from({ length: numFinances }).map((_, i) => ({
    type: i % 2 === 0 ? 'INCOME' as const : 'EXPENSE' as const,
    category: 'GENERAL',
    amount: 100 + Math.random() * 900,
    description: `Transaction ${i}`,
    paymentMethod: 'CASH',
    transactionRef: `TRX-${now}-${i}`,
    date: new Date(now - (Math.random() * 10000000000)),
    userId: user!.id,
  }));
  for (let i = 0; i < fData.length; i += CHUNK_SIZE) {
    await prisma.finance.createMany({ data: fData.slice(i, i + CHUNK_SIZE) });
  }

  console.log(`    Seeding completed.\n`);
}

function getMemory() {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024), // MB
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024), // MB
  };
}

async function measure(name: string, fn: () => Promise<any>) {
  const startMem = getMemory();
  const startTime = performance.now();
  
  const result = await fn();
  
  const endTime = performance.now();
  const endMem = getMemory();
  
  const timeMs = Math.round(endTime - startTime);
  const memDiff = endMem.heapUsed - startMem.heapUsed;
  const jsonStr = JSON.stringify(result);
  const sizeKb = Math.round((jsonStr ? jsonStr.length : 0) / 1024);
  
  console.log(`[Perf] ${name.padEnd(25)} | Time: ${timeMs.toString().padStart(5)}ms | Size: ${sizeKb.toString().padStart(5)} KB | Heap Δ: ${memDiff > 0 ? '+' : ''}${memDiff} MB`);
  
  return { timeMs, sizeKb, memDiff, result };
}

async function runTests() {
  console.log(`[2] Performance Testing Phase...`);
  
  // Base RAM
  console.log(`    Initial Memory: ${getMemory().heapUsed} MB (Heap) / ${getMemory().rss} MB (RSS)`);

  // --- 1. Dashboard ---
  await measure('Dashboard (Full Load)', async () => {
    const monthStart = new Date();
    monthStart.setDate(1);
    const [
      totalComponents, lowStockCount, monthIncome, monthExpense, monthSales, topComponents, allComponents
    ] = await Promise.all([
      prisma.component.count(),
      prisma.component.count({ where: { quantity: { lte: 5 }, isActive: true } }),
      prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "INCOME", date: { gte: monthStart } } }),
      prisma.finance.aggregate({ _sum: { amount: true }, where: { type: "EXPENSE", date: { gte: monthStart } } }),
      prisma.sale.aggregate({ _sum: { total: true, profit: true }, where: { createdAt: { gte: monthStart } } }),
      prisma.component.findMany({
        take: 5, orderBy: { totalSold: "desc" }, select: { id: true, name: true, sku: true, totalSold: true, quantity: true, unitPrice: true },
      }),
      prisma.component.findMany({
        take: 100, orderBy: [{ totalSold: "desc" }], select: { id: true, name: true, quantity: true, minQuantity: true, totalSold: true, createdAt: true },
      }),
    ]);
    return { totalComponents, lowStockCount, topComponents, allComponents };
  });

  // --- 2. Sales List (Page 1) ---
  await measure('Sales List (Page 1)', async () => {
    const skip = 0;
    const limit = 50;
    const whereClause = {};
    const [sales, count] = await Promise.all([
      prisma.sale.findMany({
        where: whereClause,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          items: { include: { component: { select: { id: true, name: true, sku: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.sale.count({ where: whereClause })
    ]);
    return { sales, count };
  });

  // --- 3. Sales Search ---
  await measure('Sales Search (Partial)', async () => {
    const whereClause = {
      OR: [
        { invoiceNumber: { contains: '123' } },
        { customer: { name: { contains: '123' } } },
      ],
    };
    const [sales, count] = await Promise.all([
      prisma.sale.findMany({
        where: whereClause,
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.sale.count({ where: whereClause })
    ]);
    return { sales, count };
  });

  // --- 4. Deep Pagination (Sales Page 500) ---
  await measure('Sales Deep Pagination(500)', async () => {
    const skip = 500 * 50;
    const limit = 50;
    const sales = await prisma.sale.findMany({
      include: {
        customer: { select: { id: true, name: true } },
        items: { include: { component: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    });
    return sales;
  });

  // --- 5. Inventory Loading ---
  await measure('Inventory List (Page 1)', async () => {
    const [components, count] = await Promise.all([
      prisma.component.findMany({
        include: {
          category: { select: { id: true, name: true, color: true } },
          supplier: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: 0,
        take: 50,
      }),
      prisma.component.count()
    ]);
    return { components, count };
  });

  // --- 6. Write Operation (Create Sale) ---
  await measure('Create Sale (Write test)', async () => {
    const p = await prisma.component.findFirst();
    const user = await prisma.user.findFirst({ where: { email: 'stress@test.local' } });
    return await prisma.sale.create({
      data: {
        invoiceNumber: `TEST-WRITE-${Date.now()}`,
        total: p!.unitPrice,
        profit: p!.unitPrice - p!.unitCost,
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        userId: user!.id,
        items: {
          create: [{ componentId: p!.id, quantity: 1, unitPrice: p!.unitPrice, unitCost: p!.unitCost, totalPrice: p!.unitPrice, totalCost: p!.unitCost, profit: p!.unitPrice - p!.unitCost }]
        }
      }
    });
  });

  // Check EXPLAIN QUERY PLAN for a heavy search query
  console.log(`\n[3] Query Plan Analysis...`);
  try {
    const plan = await prisma.$queryRaw`EXPLAIN QUERY PLAN SELECT "Sale"."id" FROM "Sale" LEFT JOIN "Customer" ON "Sale"."customerId" = "Customer"."id" WHERE ("Sale"."invoiceNumber" LIKE '%123%' OR "Customer"."name" LIKE '%123%') ORDER BY "Sale"."createdAt" DESC LIMIT 50`;
    console.log("    Search Query Plan:", JSON.stringify(plan, null, 2));
  } catch (e) {
    console.log("    (Could not fetch explain query plan for raw SQL due to Prisma limitations/types)");
  }

  try {
    const plan2 = await prisma.$queryRaw`EXPLAIN QUERY PLAN SELECT "Sale"."id" FROM "Sale" ORDER BY "Sale"."createdAt" DESC LIMIT 50 OFFSET 25000`;
    console.log("    Deep Pagination Plan:", JSON.stringify(plan2, null, 2));
  } catch (e) {}

  console.log(`\n[4] Final Memory Check: ${getMemory().heapUsed} MB (Heap) / ${getMemory().rss} MB (RSS)`);
  console.log(`======================================================\n`);
}

async function main() {
  await runSeed();
  await runTests();
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
