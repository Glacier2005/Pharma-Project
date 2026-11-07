import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function main() {
  // Clean slate
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.pharmacy.deleteMany();
  await prisma.user.deleteMany();

  // ── Pharmacy ──────────────────────────────────────────────────────────────
  const pharmacy = await prisma.pharmacy.create({
    data: {
      name: "CityCare Pharmacy — Downtown",
      latitude: 40.7128,
      longitude: -74.006,
    },
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  const [customerHash, riderHash, adminHash] = await Promise.all([
    bcrypt.hash("customer123", SALT_ROUNDS),
    bcrypt.hash("rider123", SALT_ROUNDS),
    bcrypt.hash("admin123", SALT_ROUNDS),
  ]);

  const customer = await prisma.user.create({
    data: {
      role: "CUSTOMER",
      phone_number: "+15550100001",
      full_name: "Alex Rivera",
      password_hash: customerHash,
    },
  });

  const rider = await prisma.user.create({
    data: {
      role: "RIDER",
      phone_number: "+15550100002",
      full_name: "Jordan Blake",
      password_hash: riderHash,
    },
  });

  const admin = await prisma.user.create({
    data: {
      role: "ADMIN",
      phone_number: "+15550100003",
      full_name: "Morgan Ellis",
      password_hash: adminHash,
    },
  });

  // ── Medicines ─────────────────────────────────────────────────────────────
  await prisma.medicine.createMany({
    data: [
      { name: "Amoxicillin 500 mg capsules", generic_name: "Amoxicillin", price: "12.99", requires_prescription: true },
      { name: "Paracetamol 500 mg tablets", generic_name: "Acetaminophen", price: "4.25", requires_prescription: false },
      { name: "Ibuprofen 400 mg tablets", generic_name: "Ibuprofen", price: "6.50", requires_prescription: false },
      { name: "Omeprazole 20 mg delayed-release capsules", generic_name: "Omeprazole", price: "18.75", requires_prescription: true },
      { name: "Loratadine 10 mg tablets", generic_name: "Loratadine", price: "9.99", requires_prescription: false },
    ],
  });

  const created = await prisma.medicine.findMany({ orderBy: { name: "asc" } });

  const stockByName: Record<string, number> = {
    "Amoxicillin 500 mg capsules": 120,
    "Ibuprofen 400 mg tablets": 200,
    "Loratadine 10 mg tablets": 85,
    "Omeprazole 20 mg delayed-release capsules": 60,
    "Paracetamol 500 mg tablets": 300,
  };

  const inventories = await prisma.inventory.createManyAndReturn({
    data: created.map((m) => ({
      pharmacyId: pharmacy.id,
      medicineId: m.id,
    })),
  });

  const batchesToCreate = inventories.map(inv => {
    const medName = created.find(m => m.id === inv.medicineId)?.name || "";
    const qty = stockByName[medName] ?? 50;
    return {
      inventoryId: inv.id,
      batchNumber: `SEED-${inv.id}`,
      quantity: qty,
      expiryDate: new Date("2099-12-31"),
      isLegacy: true,
    };
  });

  await prisma.batch.createMany({ data: batchesToCreate });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n✅ Seed complete.");
  console.log(`\n📦 Pharmacy:    ${pharmacy.name} (${pharmacy.id})`);
  console.log(`\n👤 Test Users:`);
  console.log(`   CUSTOMER  phone=+15550100001  password=customer123  id=${customer.id}`);
  console.log(`   RIDER     phone=+15550100002  password=rider123     id=${rider.id}`);
  console.log(`   ADMIN     phone=+15550100003  password=admin123     id=${admin.id}`);
  console.log(`\n💊 Medicines: ${created.length} seeded`);
  console.log(`\nPOST /api/auth/login  { "phone_number": "+15550100001", "password": "customer123" }\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
