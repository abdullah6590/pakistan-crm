// prisma/seed.ts - Seed data for development
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { hash } from "bcryptjs";

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Clean existing data ────────────────────────────────
  await prisma.notification.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.inventoryHistory.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.projectComponent.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.component.deleteMany();
  await prisma.componentCategory.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.finance.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();

  // ─── Users ──────────────────────────────────────────────
  const hashedPassword = await hash("admin123", 12);

  const admin = await prisma.user.create({
    data: {
      name: "Shah Rukh",
      email: "admin@electronics.pk",
      password: hashedPassword,
      role: "ADMIN",
      phone: "+92 300 1234567",
      address: "Lahore, Pakistan",
    },
  });

  const employee = await prisma.user.create({
    data: {
      name: "Ali Hassan",
      email: "ali@electronics.pk",
      password: hashedPassword,
      role: "EMPLOYEE",
      phone: "+92 321 9876543",
    },
  });

  const inventoryMgr = await prisma.user.create({
    data: {
      name: "Fatima Khan",
      email: "fatima@electronics.pk",
      password: hashedPassword,
      role: "INVENTORY_MANAGER",
      phone: "+92 333 4455667",
    },
  });

  const accountant = await prisma.user.create({
    data: {
      name: "Usman Dar",
      email: "usman@electronics.pk",
      password: hashedPassword,
      role: "ACCOUNTANT",
      phone: "+92 312 7788990",
    },
  });

  const partner = await prisma.user.create({
    data: {
      name: "Ahmed Sheikh",
      email: "ahmed@electronics.pk",
      password: hashedPassword,
      role: "PARTNER",
      phone: "+92 345 1122334",
    },
  });

  console.log("✅ Users created");

  // ─── Component Categories ───────────────────────────────
  const categories = await Promise.all([
    prisma.componentCategory.create({ data: { name: "Microcontrollers", icon: "Cpu", color: "#3B82F6", description: "Arduino, ESP32, STM32, etc." } }),
    prisma.componentCategory.create({ data: { name: "Sensors", icon: "Activity", color: "#10B981", description: "Temperature, humidity, motion, etc." } }),
    prisma.componentCategory.create({ data: { name: "Resistors", icon: "Zap", color: "#F59E0B" } }),
    prisma.componentCategory.create({ data: { name: "Capacitors", icon: "Disc", color: "#8B5CF6" } }),
    prisma.componentCategory.create({ data: { name: "Diodes & LEDs", icon: "Lightbulb", color: "#EF4444" } }),
    prisma.componentCategory.create({ data: { name: "Transistors & MOSFETs", icon: "Cpu", color: "#06B6D4" } }),
    prisma.componentCategory.create({ data: { name: "Connectors & Headers", icon: "Plug", color: "#64748B" } }),
    prisma.componentCategory.create({ data: { name: "Wires & Cables", icon: "Cable", color: "#78716C" } }),
    prisma.componentCategory.create({ data: { name: "Power Modules", icon: "Battery", color: "#22C55E" } }),
    prisma.componentCategory.create({ data: { name: "PCB & Boards", icon: "Layers", color: "#14B8A6" } }),
    prisma.componentCategory.create({ data: { name: "Motors & Actuators", icon: "RotateCw", color: "#F97316" } }),
    prisma.componentCategory.create({ data: { name: "Displays & Screens", icon: "Monitor", color: "#6366F1" } }),
    prisma.componentCategory.create({ data: { name: "Wireless Modules", icon: "Radio", color: "#D946EF" } }),
    prisma.componentCategory.create({ data: { name: "ICs & Chips", icon: "Cpu", color: "#0EA5E9" } }),
    prisma.componentCategory.create({ data: { name: "Tools & Accessories", icon: "Wrench", color: "#9CA3AF" } }),
    prisma.componentCategory.create({ data: { name: "Batteries", icon: "BatteryFull", color: "#84CC16" } }),
  ]);

  console.log("✅ Categories created");

  // ─── Suppliers ──────────────────────────────────────────
  const suppliers = await Promise.all([
    prisma.supplier.create({ data: { name: "Hall Road Electronics", company: "Lahore Electronics Hub", phone: "+92 42 1112223", city: "Lahore", country: "Pakistan", totalPurchased: 450000 } }),
    prisma.supplier.create({ data: { name: "DigiKey Pakistan", company: "DigiKey Distributors", phone: "+92 21 3334445", city: "Karachi", country: "Pakistan", totalPurchased: 320000 } }),
    prisma.supplier.create({ data: { name: "AliExpress Direct", company: "Shenzhen Trading Co.", phone: "+86 755 123456", city: "Shenzhen", country: "China", totalPurchased: 180000 } }),
    prisma.supplier.create({ data: { name: "Karachi Electronics", company: "Karachi Traders", phone: "+92 21 5556667", city: "Karachi", country: "Pakistan", totalPurchased: 250000 } }),
  ]);

  console.log("✅ Suppliers created");

  // ─── Customers ──────────────────────────────────────────
  const customers = await Promise.all([
    prisma.customer.create({ data: { name: "UET Lahore", email: "ee@uet.edu.pk", phone: "+92 42 99021234", city: "Lahore", address: "G.T. Road, Lahore", totalPurchased: 125000, visitCount: 8 } }),
    prisma.customer.create({ data: { name: "FAST University", email: "ee@nu.edu.pk", phone: "+92 42 35655123", city: "Lahore", totalPurchased: 98000, visitCount: 5 } }),
    prisma.customer.create({ data: { name: "Tech Innovators", email: "info@techinnovators.pk", phone: "+92 300 8765432", city: "Islamabad", totalPurchased: 67000, visitCount: 3 } }),
    prisma.customer.create({ data: { name: "DIY Electronics Store", email: "diy@electronics.pk", phone: "+92 321 1122334", city: "Rawalpindi", totalPurchased: 45000, visitCount: 12 } }),
    prisma.customer.create({ data: { name: "Bilal Hardware", email: "bilal@hardware.pk", phone: "+92 333 8899001", city: "Faisalabad", totalPurchased: 32000, visitCount: 6 } }),
  ]);

  console.log("✅ Customers created");

  // ─── Partners ───────────────────────────────────────────
  const partnerRecord = await prisma.partner.create({
    data: {
      name: "Ahmed Sheikh",
      email: "ahmed@electronics.pk",
      phone: "+92 345 1122334",
      investmentAmount: 1500000,
      profitSharePercent: 25,
      totalWithdrawals: 200000,
      notes: "Co-founder, 25% profit share",
      isActive: true,
    },
  });

  console.log("✅ Partner created");

  // ─── Components ─────────────────────────────────────────
  const components = await Promise.all([
    // Microcontrollers
    prisma.component.create({ data: { sku: "MCU-001", name: "Arduino Uno R3", categoryId: categories[0].id, quantity: 25, minQuantity: 5, unitCost: 1200, unitPrice: 1800, supplierId: suppliers[0].id, location: "Shelf A1", totalPurchased: 50, totalSold: 25 } }),
    prisma.component.create({ data: { sku: "MCU-002", name: "ESP32 DevKit", categoryId: categories[0].id, quantity: 40, minQuantity: 10, unitCost: 950, unitPrice: 1500, supplierId: suppliers[0].id, location: "Shelf A1", totalPurchased: 80, totalSold: 40 } }),
    prisma.component.create({ data: { sku: "MCU-003", name: "Arduino Nano", categoryId: categories[0].id, quantity: 15, minQuantity: 5, unitCost: 600, unitPrice: 950, supplierId: suppliers[1].id, location: "Shelf A2", totalPurchased: 40, totalSold: 25 } }),
    prisma.component.create({ data: { sku: "MCU-004", name: "STM32 Blue Pill", categoryId: categories[0].id, quantity: 30, minQuantity: 5, unitCost: 750, unitPrice: 1200, supplierId: suppliers[2].id, location: "Shelf A2", totalPurchased: 50, totalSold: 20 } }),
    prisma.component.create({ data: { sku: "MCU-005", name: "Raspberry Pi Pico", categoryId: categories[0].id, quantity: 3, minQuantity: 5, unitCost: 850, unitPrice: 1400, supplierId: suppliers[1].id, location: "Shelf A3", totalPurchased: 20, totalSold: 17 } }),

    // Sensors
    prisma.component.create({ data: { sku: "SEN-001", name: "DHT22 Temp/Humidity Sensor", categoryId: categories[1].id, quantity: 50, minQuantity: 10, unitCost: 450, unitPrice: 750, supplierId: suppliers[0].id, location: "Shelf B1", totalPurchased: 100, totalSold: 50 } }),
    prisma.component.create({ data: { sku: "SEN-002", name: "HC-SR04 Ultrasonic Sensor", categoryId: categories[1].id, quantity: 35, minQuantity: 10, unitCost: 200, unitPrice: 350, supplierId: suppliers[0].id, location: "Shelf B1", totalPurchased: 80, totalSold: 45 } }),
    prisma.component.create({ data: { sku: "SEN-003", name: "PIR Motion Sensor", categoryId: categories[1].id, quantity: 28, minQuantity: 5, unitCost: 180, unitPrice: 300, supplierId: suppliers[2].id, location: "Shelf B2", totalPurchased: 60, totalSold: 32 } }),
    prisma.component.create({ data: { sku: "SEN-004", name: "IR Obstacle Sensor", categoryId: categories[1].id, quantity: 45, minQuantity: 10, unitCost: 80, unitPrice: 150, supplierId: suppliers[0].id, location: "Shelf B2", totalPurchased: 90, totalSold: 45 } }),
    prisma.component.create({ data: { sku: "SEN-005", name: "LDR Light Sensor", categoryId: categories[1].id, quantity: 2, minQuantity: 10, unitCost: 25, unitPrice: 60, supplierId: suppliers[0].id, location: "Shelf B3", totalPurchased: 100, totalSold: 98 } }),

    // Resistors
    prisma.component.create({ data: { sku: "RES-001", name: "Resistor Kit 1/4W (100pc)", categoryId: categories[2].id, quantity: 60, minQuantity: 15, unitCost: 200, unitPrice: 400, supplierId: suppliers[0].id, location: "Shelf C1", totalPurchased: 100, totalSold: 40 } }),
    prisma.component.create({ data: { sku: "RES-002", name: "Potentiometer 10K", categoryId: categories[2].id, quantity: 40, minQuantity: 10, unitCost: 35, unitPrice: 80, supplierId: suppliers[0].id, location: "Shelf C1", totalPurchased: 150, totalSold: 110 } }),

    // Capacitors
    prisma.component.create({ data: { sku: "CAP-001", name: "Electrolytic Cap Kit (Assorted)", categoryId: categories[3].id, quantity: 25, minQuantity: 10, unitCost: 400, unitPrice: 700, supplierId: suppliers[0].id, location: "Shelf C2", totalPurchased: 50, totalSold: 25 } }),
    prisma.component.create({ data: { sku: "CAP-002", name: "Ceramic Cap Kit (Assorted)", categoryId: categories[3].id, quantity: 30, minQuantity: 10, unitCost: 300, unitPrice: 550, supplierId: suppliers[0].id, location: "Shelf C2", totalPurchased: 60, totalSold: 30 } }),

    // Diodes & LEDs
    prisma.component.create({ data: { sku: "LED-001", name: "LED 5mm Assorted (100pc)", categoryId: categories[4].id, quantity: 80, minQuantity: 20, unitCost: 250, unitPrice: 500, supplierId: suppliers[0].id, location: "Shelf D1", totalPurchased: 150, totalSold: 70 } }),
    prisma.component.create({ data: { sku: "LED-002", name: "1N4007 Rectifier Diode (50pc)", categoryId: categories[4].id, quantity: 35, minQuantity: 10, unitCost: 150, unitPrice: 300, supplierId: suppliers[0].id, location: "Shelf D1", totalPurchased: 80, totalSold: 45 } }),

    // Transistors & MOSFETs
    prisma.component.create({ data: { sku: "TRA-001", name: "BC547 NPN Transistor (20pc)", categoryId: categories[5].id, quantity: 50, minQuantity: 15, unitCost: 120, unitPrice: 250, supplierId: suppliers[0].id, location: "Shelf D2", totalPurchased: 100, totalSold: 50 } }),
    prisma.component.create({ data: { sku: "TRA-002", name: "IRFZ44N MOSFET", categoryId: categories[5].id, quantity: 20, minQuantity: 5, unitCost: 85, unitPrice: 180, supplierId: suppliers[0].id, location: "Shelf D2", totalPurchased: 60, totalSold: 40 } }),

    // Power Modules
    prisma.component.create({ data: { sku: "PWR-001", name: "LM2596 Buck Converter", categoryId: categories[8].id, quantity: 35, minQuantity: 5, unitCost: 280, unitPrice: 500, supplierId: suppliers[0].id, location: "Shelf E1", totalPurchased: 80, totalSold: 45 } }),
    prisma.component.create({ data: { sku: "PWR-002", name: "TP4056 Charging Module", categoryId: categories[8].id, quantity: 55, minQuantity: 10, unitCost: 85, unitPrice: 180, supplierId: suppliers[2].id, location: "Shelf E1", totalPurchased: 120, totalSold: 65 } }),
    prisma.component.create({ data: { sku: "PWR-003", name: "9V Battery Connector", categoryId: categories[8].id, quantity: 8, minQuantity: 15, unitCost: 25, unitPrice: 55, supplierId: suppliers[0].id, location: "Shelf E2", totalPurchased: 100, totalSold: 92 } }),

    // Motors
    prisma.component.create({ data: { sku: "MOT-001", name: "28BYJ-48 Stepper Motor", categoryId: categories[10].id, quantity: 18, minQuantity: 5, unitCost: 380, unitPrice: 650, supplierId: suppliers[0].id, location: "Shelf F1", totalPurchased: 40, totalSold: 22 } }),
    prisma.component.create({ data: { sku: "MOT-002", name: "SG90 Micro Servo", categoryId: categories[10].id, quantity: 30, minQuantity: 10, unitCost: 250, unitPrice: 450, supplierId: suppliers[0].id, location: "Shelf F1", totalPurchased: 80, totalSold: 50 } }),
    prisma.component.create({ data: { sku: "MOT-003", name: "L298N Motor Driver", categoryId: categories[10].id, quantity: 22, minQuantity: 5, unitCost: 350, unitPrice: 600, supplierId: suppliers[1].id, location: "Shelf F2", totalPurchased: 50, totalSold: 28 } }),

    // Displays
    prisma.component.create({ data: { sku: "DSP-001", name: "16x2 LCD Display (Blue)", categoryId: categories[11].id, quantity: 38, minQuantity: 10, unitCost: 350, unitPrice: 600, supplierId: suppliers[0].id, location: "Shelf G1", totalPurchased: 80, totalSold: 42 } }),
    prisma.component.create({ data: { sku: "DSP-002", name: "0.96 OLED Display (I2C)", categoryId: categories[11].id, quantity: 25, minQuantity: 5, unitCost: 550, unitPrice: 950, supplierId: suppliers[1].id, location: "Shelf G1", totalPurchased: 50, totalSold: 25 } }),
    prisma.component.create({ data: { sku: "DSP-003", name: "7-Segment Display (4-Digit)", categoryId: categories[11].id, quantity: 42, minQuantity: 10, unitCost: 95, unitPrice: 200, supplierId: suppliers[0].id, location: "Shelf G2", totalPurchased: 100, totalSold: 58 } }),

    // Wireless
    prisma.component.create({ data: { sku: "WLS-001", name: "HC-05 Bluetooth Module", categoryId: categories[12].id, quantity: 20, minQuantity: 5, unitCost: 580, unitPrice: 950, supplierId: suppliers[0].id, location: "Shelf H1", totalPurchased: 45, totalSold: 25 } }),
    prisma.component.create({ data: { sku: "WLS-002", name: "NRF24L01 Transceiver", categoryId: categories[12].id, quantity: 32, minQuantity: 10, unitCost: 250, unitPrice: 450, supplierId: suppliers[0].id, location: "Shelf H1", totalPurchased: 70, totalSold: 38 } }),
    prisma.component.create({ data: { sku: "WLS-003", name: "SIM800L GSM Module", categoryId: categories[12].id, quantity: 4, minQuantity: 3, unitCost: 1850, unitPrice: 2800, supplierId: suppliers[1].id, location: "Shelf H2", totalPurchased: 15, totalSold: 11 } }),

    // Jumper wires, breadboards, etc.
    prisma.component.create({ data: { sku: "ACC-001", name: "Breadboard 830 Points", categoryId: categories[14].id, quantity: 50, minQuantity: 15, unitCost: 120, unitPrice: 250, supplierId: suppliers[0].id, location: "Shelf I1", totalPurchased: 120, totalSold: 70 } }),
    prisma.component.create({ data: { sku: "ACC-002", name: "Jumper Wires M-M (40pc)", categoryId: categories[14].id, quantity: 45, minQuantity: 15, unitCost: 80, unitPrice: 180, supplierId: suppliers[0].id, location: "Shelf I1", totalPurchased: 150, totalSold: 105 } }),
    prisma.component.create({ data: { sku: "ACC-003", name: "Jumper Wires M-F (40pc)", categoryId: categories[14].id, quantity: 38, minQuantity: 15, unitCost: 80, unitPrice: 180, supplierId: suppliers[0].id, location: "Shelf I1", totalPurchased: 120, totalSold: 82 } }),
    prisma.component.create({ data: { sku: "ACC-004", name: "Soldering Iron 60W", categoryId: categories[14].id, quantity: 12, minQuantity: 5, unitCost: 750, unitPrice: 1200, supplierId: suppliers[0].id, location: "Shelf I2", totalPurchased: 25, totalSold: 13 } }),
    prisma.component.create({ data: { sku: "ACC-005", name: "Multimeter DT830D", categoryId: categories[14].id, quantity: 8, minQuantity: 5, unitCost: 550, unitPrice: 950, supplierId: suppliers[0].id, location: "Shelf I2", totalPurchased: 20, totalSold: 12 } }),
  ]);

  console.log("✅ 35 components created");

  // ─── Projects ───────────────────────────────────────────
  const projects = await Promise.all([
    prisma.project.create({
      data: {
        projectId: "PRJ-001",
        name: "Workshop IoT Training Kit",
        description: "Comprehensive IoT training kit for university workshops — includes ESP32, sensors, actuators, and power modules.",
        clientName: "UET Lahore",
        clientPhone: "+92 42 99021234",
        clientEmail: "ee@uet.edu.pk",
        startDate: new Date("2025-10-01"),
        deadline: new Date("2026-06-30"),
        status: "IN_PROGRESS",
        laborCost: 45000,
        otherCosts: 12000,
        clientPayment: 250000,
        paymentStatus: "PARTIAL",
        userId: admin.id,
        color: "#3B82F6",
      },
    }),
    prisma.project.create({
      data: {
        projectId: "PRJ-002",
        name: "Color Sorter Machine",
        description: "Automated color sorting system using TCS3200 sensor and conveyor belt mechanism for industrial use.",
        clientName: "Tech Innovators",
        clientPhone: "+92 300 8765432",
        clientEmail: "info@techinnovators.pk",
        startDate: new Date("2025-11-15"),
        deadline: new Date("2026-08-15"),
        status: "IN_PROGRESS",
        laborCost: 85000,
        otherCosts: 25000,
        clientPayment: 400000,
        paymentStatus: "PARTIAL",
        userId: admin.id,
        color: "#10B981",
      },
    }),
    prisma.project.create({
      data: {
        projectId: "PRJ-003",
        name: "IoT 12 Kits for UET",
        description: "12 complete IoT training kits for UET Electrical Engineering department.",
        clientName: "UET Lahore - EE Dept",
        clientPhone: "+92 42 99021234",
        clientEmail: "ee@uet.edu.pk",
        startDate: new Date("2026-01-05"),
        deadline: new Date("2026-07-15"),
        status: "IN_PROGRESS",
        laborCost: 30000,
        otherCosts: 8000,
        clientPayment: 180000,
        paymentStatus: "PARTIAL",
        userId: employee.id,
        color: "#F59E0B",
      },
    }),
    prisma.project.create({
      data: {
        projectId: "PRJ-004",
        name: "DLD Lab Kits (Digital Logic)",
        description: "Digital Logic Design lab kits with breadboard, logic gates, displays, and power supply for university labs.",
        clientName: "FAST University",
        clientPhone: "+92 42 35655123",
        clientEmail: "ee@nu.edu.pk",
        startDate: new Date("2026-02-01"),
        deadline: new Date("2026-09-30"),
        status: "IN_PROGRESS",
        laborCost: 55000,
        otherCosts: 15000,
        clientPayment: 320000,
        paymentStatus: "PARTIAL",
        userId: admin.id,
        color: "#8B5CF6",
      },
    }),
    prisma.project.create({
      data: {
        projectId: "PRJ-005",
        name: "Smart Home Automation Demo",
        description: "Showcase home automation system with relays, ESP32, and mobile app control.",
        status: "PLANNING",
        laborCost: 20000,
        otherCosts: 5000,
        clientPayment: 0,
        paymentStatus: "PENDING",
        userId: admin.id,
        color: "#EF4444",
      },
    }),
    prisma.project.create({
      data: {
        projectId: "PRJ-006",
        name: "Solar Tracker Prototype",
        description: "Solar panel tracking system using LDR sensors and servo motors for optimal energy capture.",
        status: "PLANNING",
        laborCost: 15000,
        otherCosts: 8000,
        clientPayment: 0,
        paymentStatus: "PENDING",
        userId: employee.id,
        color: "#06B6D4",
      },
    }),
  ]);

  console.log("✅ 6 projects created");

  // ─── Project Components ─────────────────────────────────
  // Assign components to projects
  // PRJ-001: Workshop IoT Training Kit
  await Promise.all([
    prisma.projectComponent.create({ data: { projectId: projects[0].id, componentId: components[1].id, quantity: 15, unitCost: 950, totalCost: 14250 } }), // ESP32
    prisma.projectComponent.create({ data: { projectId: projects[0].id, componentId: components[5].id, quantity: 15, unitCost: 450, totalCost: 6750 } }),  // DHT22
    prisma.projectComponent.create({ data: { projectId: projects[0].id, componentId: components[6].id, quantity: 15, unitCost: 200, totalCost: 3000 } }),  // HC-SR04
    prisma.projectComponent.create({ data: { projectId: projects[0].id, componentId: components[19].id, quantity: 15, unitCost: 280, totalCost: 4200 } }),  // LM2596
    prisma.projectComponent.create({ data: { projectId: projects[0].id, componentId: components[32].id, quantity: 15, unitCost: 120, totalCost: 1800 } }),  // Breadboard
    prisma.projectComponent.create({ data: { projectId: projects[0].id, componentId: components[33].id, quantity: 40, unitCost: 80, totalCost: 3200 } }),  // Jumper M-M
  ]);

  // PRJ-002: Color Sorter
  await Promise.all([
    prisma.projectComponent.create({ data: { projectId: projects[1].id, componentId: components[0].id, quantity: 2, unitCost: 1200, totalCost: 2400 } }),  // Arduino Uno
    prisma.projectComponent.create({ data: { projectId: projects[1].id, componentId: components[8].id, quantity: 2, unitCost: 25, totalCost: 50 } }),    // LDR
    prisma.projectComponent.create({ data: { projectId: projects[1].id, componentId: components[22].id, quantity: 3, unitCost: 380, totalCost: 1140 } }),  // Stepper
    prisma.projectComponent.create({ data: { projectId: projects[1].id, componentId: components[24].id, quantity: 2, unitCost: 350, totalCost: 700 } }),  // L298N
    prisma.projectComponent.create({ data: { projectId: projects[1].id, componentId: components[15].id, quantity: 5, unitCost: 250, totalCost: 1250 } }),  // LEDs
  ]);

  // PRJ-003: IoT 12 Kits
  await Promise.all([
    prisma.projectComponent.create({ data: { projectId: projects[2].id, componentId: components[1].id, quantity: 12, unitCost: 950, totalCost: 11400 } }),  // ESP32
    prisma.projectComponent.create({ data: { projectId: projects[2].id, componentId: components[5].id, quantity: 12, unitCost: 450, totalCost: 5400 } }),   // DHT22
    prisma.projectComponent.create({ data: { projectId: projects[2].id, componentId: components[6].id, quantity: 12, unitCost: 200, totalCost: 2400 } }),   // HC-SR04
    prisma.projectComponent.create({ data: { projectId: projects[2].id, componentId: components[32].id, quantity: 12, unitCost: 120, totalCost: 1440 } }),   // Breadboard
    prisma.projectComponent.create({ data: { projectId: projects[2].id, componentId: components[33].id, quantity: 24, unitCost: 80, totalCost: 1920 } }),    // Jumper M-M
  ]);

  // PRJ-004: DLD Lab Kits
  await Promise.all([
    prisma.projectComponent.create({ data: { projectId: projects[3].id, componentId: components[27].id, quantity: 20, unitCost: 95, totalCost: 1900 } }),   // 7-Segment
    prisma.projectComponent.create({ data: { projectId: projects[3].id, componentId: components[32].id, quantity: 20, unitCost: 120, totalCost: 2400 } }),   // Breadboard
    prisma.projectComponent.create({ data: { projectId: projects[3].id, componentId: components[16].id, quantity: 20, unitCost: 250, totalCost: 5000 } }),   // LEDs
    prisma.projectComponent.create({ data: { projectId: projects[3].id, componentId: components[34].id, quantity: 40, unitCost: 80, totalCost: 3200 } }),    // Jumper M-F
  ]);

  console.log("✅ Project components assigned");

  // ─── Update project costs ───────────────────────────────
  for (const project of projects) {
    const componentsTotal = await prisma.projectComponent.aggregate({
      _sum: { totalCost: true },
      where: { projectId: project.id },
    });
    const totalCost = project.laborCost + project.otherCosts + (componentsTotal._sum.totalCost || 0);
    const profit = project.clientPayment - totalCost;
    const remainingPayment = Math.max(0, project.clientPayment - totalCost);
    await prisma.project.update({
      where: { id: project.id },
      data: { totalCost, profit, remainingPayment, paymentStatus: project.clientPayment >= totalCost ? "PAID" : "PARTIAL" },
    });
  }

  console.log("✅ Project costs calculated");

  // ─── Sales ──────────────────────────────────────────────
  const sales = await Promise.all([
    prisma.sale.create({
      data: {
        invoiceNumber: "INV-001",
        customerId: customers[0].id,
        subtotal: 25000,
        discount: 2000,
        tax: 0,
        total: 23000,
        profit: 8500,
        paymentMethod: "BANK_TRANSFER",
        paymentStatus: "PAID",
        userId: admin.id,
      },
    }),
    prisma.sale.create({
      data: {
        invoiceNumber: "INV-002",
        customerId: customers[2].id,
        subtotal: 18000,
        discount: 0,
        tax: 0,
        total: 18000,
        profit: 6200,
        paymentMethod: "JAZZCASH",
        paymentStatus: "PAID",
        userId: admin.id,
      },
    }),
    prisma.sale.create({
      data: {
        invoiceNumber: "INV-003",
        walkInName: "Usman Ali",
        subtotal: 5200,
        discount: 200,
        tax: 0,
        total: 5000,
        profit: 1800,
        paymentMethod: "CASH",
        paymentStatus: "PAID",
        userId: employee.id,
      },
    }),
    prisma.sale.create({
      data: {
        invoiceNumber: "INV-004",
        customerId: customers[3].id,
        subtotal: 8500,
        discount: 500,
        tax: 0,
        total: 8000,
        profit: 2900,
        paymentMethod: "EASYPAISA",
        paymentStatus: "PAID",
        userId: employee.id,
      },
    }),
    prisma.sale.create({
      data: {
        invoiceNumber: "INV-005",
        walkInName: "Hassan Raza",
        subtotal: 3200,
        discount: 0,
        tax: 0,
        total: 3200,
        profit: 1150,
        paymentMethod: "CASH",
        paymentStatus: "PAID",
        userId: admin.id,
      },
    }),
  ]);

  // Sale items
  await Promise.all([
    // INV-001 items
    prisma.saleItem.create({ data: { saleId: sales[0].id, componentId: components[1].id, quantity: 8, unitCost: 950, unitPrice: 1500, totalCost: 7600, totalPrice: 12000, profit: 4400 } }),
    prisma.saleItem.create({ data: { saleId: sales[0].id, componentId: components[5].id, quantity: 10, unitCost: 450, unitPrice: 750, totalCost: 4500, totalPrice: 7500, profit: 3000 } }),
    prisma.saleItem.create({ data: { saleId: sales[0].id, componentId: components[0].id, quantity: 3, unitCost: 1200, unitPrice: 1800, totalCost: 3600, totalPrice: 5400, profit: 1800 } }),
    // INV-002 items
    prisma.saleItem.create({ data: { saleId: sales[1].id, componentId: components[27].id, quantity: 30, unitCost: 95, unitPrice: 200, totalCost: 2850, totalPrice: 6000, profit: 3150 } }),
    prisma.saleItem.create({ data: { saleId: sales[1].id, componentId: components[22].id, quantity: 10, unitCost: 380, unitPrice: 650, totalCost: 3800, totalPrice: 6500, profit: 2700 } }),
    prisma.saleItem.create({ data: { saleId: sales[1].id, componentId: components[32].id, quantity: 20, unitCost: 120, unitPrice: 250, totalCost: 2400, totalPrice: 5000, profit: 2600 } }),
    // INV-003: Walk-in
    prisma.saleItem.create({ data: { saleId: sales[2].id, componentId: components[3].id, quantity: 2, unitCost: 750, unitPrice: 1200, totalCost: 1500, totalPrice: 2400, profit: 900 } }),
    prisma.saleItem.create({ data: { saleId: sales[2].id, componentId: components[16].id, quantity: 3, unitCost: 250, unitPrice: 500, totalCost: 750, totalPrice: 1500, profit: 750 } }),
    prisma.saleItem.create({ data: { saleId: sales[2].id, componentId: components[33].id, quantity: 5, unitCost: 80, unitPrice: 180, totalCost: 400, totalPrice: 900, profit: 500 } }),
    // INV-004 items
    prisma.saleItem.create({ data: { saleId: sales[3].id, componentId: components[26].id, quantity: 5, unitCost: 550, unitPrice: 950, totalCost: 2750, totalPrice: 4750, profit: 2000 } }),
    prisma.saleItem.create({ data: { saleId: sales[3].id, componentId: components[21].id, quantity: 5, unitCost: 250, unitPrice: 450, totalCost: 1250, totalPrice: 2250, profit: 1000 } }),
    // INV-005 items
    prisma.saleItem.create({ data: { saleId: sales[4].id, componentId: components[23].id, quantity: 4, unitCost: 250, unitPrice: 450, totalCost: 1000, totalPrice: 1800, profit: 800 } }),
    prisma.saleItem.create({ data: { saleId: sales[4].id, componentId: components[14].id, quantity: 5, unitCost: 120, unitPrice: 250, totalCost: 600, totalPrice: 1250, profit: 650 } }),
  ]);

  console.log("✅ 5 sales with items created");

  // ─── Purchases ──────────────────────────────────────────
  const purchases = await Promise.all([
    prisma.purchase.create({
      data: {
        poNumber: "PO-001",
        supplierId: suppliers[0].id,
        invoiceRef: "LHR-2025-001",
        subtotal: 75000,
        tax: 0,
        shipping: 1500,
        total: 76500,
        paymentStatus: "PAID",
        paidAmount: 76500,
        userId: admin.id,
      },
    }),
    prisma.purchase.create({
      data: {
        poNumber: "PO-002",
        supplierId: suppliers[1].id,
        invoiceRef: "DGK-2025-042",
        subtotal: 45000,
        tax: 0,
        shipping: 2500,
        total: 47500,
        paymentStatus: "PAID",
        paidAmount: 47500,
        userId: admin.id,
      },
    }),
    prisma.purchase.create({
      data: {
        poNumber: "PO-003",
        supplierId: suppliers[0].id,
        invoiceRef: "LHR-2026-015",
        subtotal: 32000,
        tax: 1600,
        shipping: 1000,
        total: 34600,
        paymentStatus: "PARTIAL",
        paidAmount: 20000,
        userId: inventoryMgr.id,
      },
    }),
  ]);

  // Purchase items
  await Promise.all([
    prisma.purchaseItem.create({ data: { purchaseId: purchases[0].id, componentId: components[0].id, quantity: 50, unitCost: 1100, totalCost: 55000 } }),
    prisma.purchaseItem.create({ data: { purchaseId: purchases[0].id, componentId: components[1].id, quantity: 40, unitCost: 900, totalCost: 36000 } }),
    prisma.purchaseItem.create({ data: { purchaseId: purchases[1].id, componentId: components[26].id, quantity: 30, unitCost: 520, totalCost: 15600 } }),
    prisma.purchaseItem.create({ data: { purchaseId: purchases[1].id, componentId: components[31].id, quantity: 20, unitCost: 240, totalCost: 4800 } }),
    prisma.purchaseItem.create({ data: { purchaseId: purchases[2].id, componentId: components[5].id, quantity: 40, unitCost: 420, totalCost: 16800 } }),
    prisma.purchaseItem.create({ data: { purchaseId: purchases[2].id, componentId: components[22].id, quantity: 25, unitCost: 360, totalCost: 9000 } }),
  ]);

  console.log("✅ 3 purchases with items created");

  // ─── Finance Records ────────────────────────────────────
  await Promise.all([
    // Income from sales
    prisma.finance.create({ data: { transactionRef: "TXN-001", type: "INCOME", category: "COMPONENT_SALE", amount: 23000, description: "Sale INV-001 to UET Lahore", paymentMethod: "BANK_TRANSFER", reference: "INV-001", referenceId: sales[0].id, date: new Date("2026-01-15"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-002", type: "INCOME", category: "COMPONENT_SALE", amount: 18000, description: "Sale INV-002 to Tech Innovators", paymentMethod: "JAZZCASH", reference: "INV-002", referenceId: sales[1].id, date: new Date("2026-02-20"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-003", type: "INCOME", category: "COMPONENT_SALE", amount: 5000, description: "Walk-in sale INV-003", paymentMethod: "CASH", reference: "INV-003", referenceId: sales[2].id, date: new Date("2026-03-10"), userId: employee.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-004", type: "INCOME", category: "COMPONENT_SALE", amount: 8000, description: "Sale INV-004 to DIY Store", paymentMethod: "EASYPAISA", reference: "INV-004", referenceId: sales[3].id, date: new Date("2026-04-05"), userId: employee.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-005", type: "INCOME", category: "COMPONENT_SALE", amount: 3200, description: "Walk-in sale INV-005", paymentMethod: "CASH", reference: "INV-005", referenceId: sales[4].id, date: new Date("2026-05-02"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-006", type: "INCOME", category: "PROJECT_PAYMENT", amount: 250000, description: "Project payment PRJ-001 from UET Lahore", paymentMethod: "BANK_TRANSFER", reference: "PRJ-001", referenceId: projects[0].id, date: new Date("2026-01-20"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-007", type: "INCOME", category: "PROJECT_PAYMENT", amount: 200000, description: "Project payment PRJ-002 from Tech Innovators", paymentMethod: "BANK_TRANSFER", reference: "PRJ-002", referenceId: projects[1].id, date: new Date("2026-02-01"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-008", type: "INCOME", category: "PROJECT_PAYMENT", amount: 180000, description: "Project payment PRJ-003 from UET EE Dept", paymentMethod: "BANK_TRANSFER", reference: "PRJ-003", referenceId: projects[2].id, date: new Date("2026-03-15"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-009", type: "INCOME", category: "PROJECT_PAYMENT", amount: 160000, description: "50% advance PRJ-004 from FAST University", paymentMethod: "BANK_TRANSFER", reference: "PRJ-004", referenceId: projects[3].id, date: new Date("2026-04-01"), userId: admin.id } }),

    // Expenses
    prisma.finance.create({ data: { transactionRef: "TXN-010", type: "EXPENSE", category: "COMPONENT_PURCHASE", amount: 76500, description: "Purchase PO-001 - Components from Hall Road", paymentMethod: "CASH", reference: "PO-001", referenceId: purchases[0].id, date: new Date("2026-01-10"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-011", type: "EXPENSE", category: "COMPONENT_PURCHASE", amount: 47500, description: "Purchase PO-002 - from DigiKey Pakistan", paymentMethod: "BANK_TRANSFER", reference: "PO-002", referenceId: purchases[1].id, date: new Date("2026-02-05"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-012", type: "EXPENSE", category: "COMPONENT_PURCHASE", amount: 20000, description: "Partial payment PO-003 - Hall Road", paymentMethod: "CASH", reference: "PO-003", referenceId: purchases[2].id, date: new Date("2026-04-20"), userId: inventoryMgr.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-013", type: "EXPENSE", category: "SALARY", amount: 85000, description: "Team salaries - April 2026", paymentMethod: "BANK_TRANSFER", date: new Date("2026-04-30"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-014", type: "EXPENSE", category: "UTILITY", amount: 12000, description: "Electricity bill - April", paymentMethod: "BANK_TRANSFER", date: new Date("2026-04-15"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-015", type: "EXPENSE", category: "RENT", amount: 35000, description: "Workshop rent - Q1 2026", paymentMethod: "BANK_TRANSFER", date: new Date("2026-03-01"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-016", type: "EXPENSE", category: "SHIPPING", amount: 3500, description: "Courier charges for customer deliveries", paymentMethod: "CASH", date: new Date("2026-05-10"), userId: employee.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-017", type: "EXPENSE", category: "MARKETING", amount: 8000, description: "Facebook ads for electronics store", paymentMethod: "JAZZCASH", date: new Date("2026-05-05"), userId: admin.id } }),
    prisma.finance.create({ data: { transactionRef: "TXN-018", type: "INCOME", category: "OTHER_INCOME", amount: 1500000, description: "Partner investment - Ahmed Sheikh", paymentMethod: "BANK_TRANSFER", date: new Date("2026-01-01"), userId: admin.id } }),
  ]);

  console.log("✅ 18 finance records created");

  // ─── Invoices ───────────────────────────────────────────
  await Promise.all([
    prisma.invoice.create({
      data: {
        invoiceNumber: "INV-001",
        type: "SALE",
        referenceId: sales[0].id,
        customerName: "UET Lahore",
        customerEmail: "ee@uet.edu.pk",
        customerPhone: "+92 42 99021234",
        items: JSON.stringify([{ name: "ESP32 DevKit", qty: 8, price: 1500 }, { name: "DHT22 Sensor", qty: 10, price: 750 }]),
        subtotal: 25000,
        discount: 2000,
        tax: 0,
        total: 23000,
        status: "PAID",
        dueDate: new Date("2026-02-15"),
        generatedBy: admin.id,
      },
    }),
    prisma.invoice.create({
      data: {
        invoiceNumber: "PRJ-001",
        type: "PROJECT",
        referenceId: projects[0].id,
        customerName: "UET Lahore",
        customerEmail: "ee@uet.edu.pk",
        customerPhone: "+92 42 99021234",
        items: JSON.stringify([{ name: "Workshop IoT Training Kit", qty: 1, price: 250000 }]),
        subtotal: 250000,
        discount: 0,
        tax: 0,
        total: 250000,
        status: "PARTIAL",
        dueDate: new Date("2026-06-30"),
        generatedBy: admin.id,
      },
    }),
  ]);

  console.log("✅ 2 invoices created");

  // ─── Notifications ──────────────────────────────────────
  await Promise.all([
    prisma.notification.create({
      data: {
        userId: admin.id,
        type: "LOW_STOCK",
        title: "Low Stock Alert",
        message: "5 components are below minimum stock level. Please restock soon.",
        link: "/dashboard/inventory",
        isRead: false,
      },
    }),
    prisma.notification.create({
      data: {
        userId: admin.id,
        type: "PENDING_PAYMENT",
        title: "Pending Payment",
        message: "PO-003 has a pending balance of PKR 14,600 to Hall Road Electronics.",
        link: "/dashboard/purchases",
        isRead: false,
      },
    }),
    prisma.notification.create({
      data: {
        userId: admin.id,
        type: "PROJECT_DEADLINE",
        title: "Upcoming Deadline",
        message: "Workshop IoT Training Kit is due on June 30, 2026. Status: IN_PROGRESS.",
        link: "/dashboard/projects",
        isRead: true,
      },
    }),
  ]);

  console.log("✅ Notifications created");
  console.log("🎉 Seed data complete!");
  console.log("\n📋 Login Credentials:");
  console.log("   Admin:     admin@electronics.pk / admin123");
  console.log("   Employee:  ali@electronics.pk / admin123");
  console.log("   Inventory: fatima@electronics.pk / admin123");
  console.log("   Accountant: usman@electronics.pk / admin123");
  console.log("   Partner:   ahmed@electronics.pk / admin123");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });