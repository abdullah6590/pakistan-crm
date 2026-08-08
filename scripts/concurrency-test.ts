process.env.DATABASE_URL = "file:./test.db";
const prisma = require("../src/lib/prisma").prisma;

async function runConcurrencyTest() {
  console.log("=== Phase 6: Concurrency & Lock Testing ===");
  
  // 1. Generate unique identifiers for this run
  const runId = Math.random().toString(36).substring(7);

  // 2. Setup Base Data
  console.log("Creating test user and product...");
  const user = await prisma.user.create({
    data: {
      name: `Test Admin ${runId}`,
      email: `testadmin_${runId}@erp.local`,
      password: "password123",
      role: "ADMIN",
    }
  });

  const category = await prisma.componentCategory.create({
    data: { name: `Test Category ${runId}` }
  });

  const supplier = await prisma.supplier.create({
    data: { name: `Test Supplier ${runId}` }
  });

  const component = await prisma.component.create({
    data: {
      name: `Concurrency Widget ${runId}`,
      sku: `WIDGET-${runId}`,
      quantity: 20,
      unitCost: 100,
      unitPrice: 150,
      minQuantity: 5,
      isActive: true,
      categoryId: category.id,
      supplierId: supplier.id,
    }
  });

  // 3. Directly simulate the API logic for 10 concurrent requests
  // We mock the API's $transaction block to test exactly what the API does under load
  console.log(`Initial stock: ${component.quantity}. Simulating 10 concurrent requests selling 3 each...`);

  async function simulateSaleRequest(reqId: number) {
    try {
      await prisma.$transaction(async (tx: any) => {
        // 1. Create Sale
        const sale = await tx.sale.create({
          data: {
            invoiceNumber: `TEST-INV-${reqId}`,
            subtotal: 0, total: 0, profit: 0,
            paymentMethod: "CASH",
            paymentStatus: "PAID",
            userId: user.id,
          }
        });

        const qtyToSell = 3;

        // 2. Atomic Deduct (as implemented in Phase 6 API)
        const { count } = await tx.component.updateMany({
          where: { 
            id: component.id,
            quantity: { gte: qtyToSell }
          },
          data: { quantity: { decrement: qtyToSell }, totalSold: { increment: qtyToSell } },
        });

        if (count === 0) {
          throw new Error(`Insufficient stock for ${component.name}`);
        }

        // 3. Create items & history
        await tx.saleItem.create({
          data: {
            saleId: sale.id, componentId: component.id,
            quantity: qtyToSell, unitCost: 100, unitPrice: 150,
            totalCost: 300, totalPrice: 450, profit: 150,
          }
        });

        // 4. Update Sale Totals
        await tx.sale.update({
          where: { id: sale.id },
          data: { subtotal: 450, total: 450, profit: 150 }
        });
      });
      return { reqId, status: 'success' };
    } catch (error: any) {
      return { reqId, status: 'failed', reason: (error as Error).message };
    }
  }

  // Fire 10 requests at the EXACT same time
  const promises = [];
  for (let i = 1; i <= 10; i++) {
    promises.push(simulateSaleRequest(i));
  }

  const results = await Promise.all(promises);
  
  // 4. Analyze Results
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  const finalComponent = await prisma.component.findUnique({ where: { id: component.id } });
  
  console.log("\n--- TEST RESULTS ---");
  console.log(`Successful Sales: ${successful}`);
  console.log(`Failed Sales:     ${failed}`);
  console.log(`Final Stock:      ${finalComponent.quantity}`);

  if (successful === 6 && finalComponent.quantity === 2) {
    console.log("✅ Concurrency Test PASSED: No negative stock, exact bounds respected.");
  } else {
    console.log("❌ Concurrency Test FAILED: Data inconsistency detected.");
  }

  console.log("\nDetails:");
  results.forEach(r => {
    if(r.status === 'failed') console.log(`Req ${r.reqId}: ${r.reason}`);
  });
}

runConcurrencyTest().catch(console.error).finally(() => prisma.$disconnect());
