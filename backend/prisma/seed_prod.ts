import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function main() {
  console.log("Starting safe production seed...");

  // ── Pharmacy ──────────────────────────────────────────────────────────────
  let pharmacy = await prisma.pharmacy.findFirst({
    where: { name: "CityCare Pharmacy — Downtown" },
  });

  if (!pharmacy) {
    pharmacy = await prisma.pharmacy.create({
      data: {
        name: "CityCare Pharmacy — Downtown",
        latitude: 40.7128,
        longitude: -74.006,
      },
    });
    console.log("Created Pharmacy:", pharmacy.name);
  } else {
    console.log("Pharmacy already exists:", pharmacy.name);
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  const testUsers = [
    { role: "CUSTOMER", phone: "+15550100001", name: "Alex Rivera", pass: "customer123" },
    { role: "RIDER", phone: "+15550100002", name: "Jordan Blake", pass: "rider123" },
    { role: "ADMIN", phone: "+15550100003", name: "Morgan Ellis", pass: "admin123" },
    // Also include a PHARMACIST as requested by user if required by business logic
    { role: "PHARMACIST", phone: "+15550100004", name: "Taylor Swift", pass: "pharmacist123" }
  ];

  for (const u of testUsers) {
    let user = await prisma.user.findUnique({
      where: { phone_number: u.phone },
    });
    if (!user) {
      const hash = await bcrypt.hash(u.pass, SALT_ROUNDS);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = {
        role: u.role as any,
        phone_number: u.phone,
        full_name: u.name,
        password_hash: hash,
      };
      
      // If pharmacist, link to pharmacy
      if (u.role === "PHARMACIST") {
        data.pharmacyId = pharmacy.id;
      }
      
      user = await prisma.user.create({ data });
      console.log(`Created ${u.role}:`, user.full_name);
    } else {
      console.log(`${u.role} already exists:`, user.full_name);
    }
  }

  // ── Medicines ─────────────────────────────────────────────────────────────
  const medicinesData = [
    { name: "Amoxicillin 500 mg capsules", generic_name: "Amoxicillin", price: "12.99", manufacturer: "Generic", requires_prescription: true },
    { name: "Paracetamol 500 mg tablets", generic_name: "Acetaminophen", price: "4.25", manufacturer: "Generic", requires_prescription: false },
    { name: "Ibuprofen 400 mg tablets", generic_name: "Ibuprofen", price: "6.50", manufacturer: "Generic", requires_prescription: false },
    { name: "Omeprazole 20 mg delayed-release capsules", generic_name: "Omeprazole", price: "18.75", manufacturer: "Generic", requires_prescription: true },
    { name: "Loratadine 10 mg tablets", generic_name: "Loratadine", price: "9.99", manufacturer: "Generic", requires_prescription: false },
  ];

  const stockByName: Record<string, number> = {
    "Amoxicillin 500 mg capsules": 120,
    "Paracetamol 500 mg tablets": 300,
    "Ibuprofen 400 mg tablets": 200,
    "Omeprazole 20 mg delayed-release capsules": 60,
    "Loratadine 10 mg tablets": 85,
  };

  for (const m of medicinesData) {
    let med = await prisma.medicine.findFirst({
      where: { name: m.name },
    });

    if (!med) {
      med = await prisma.medicine.create({ data: m });
      console.log("Created Medicine:", med.name);
    } else {
      console.log("Medicine already exists:", med.name);
    }

    // Check Inventory
    let inv = await prisma.inventory.findFirst({
      where: { pharmacyId: pharmacy.id, medicineId: med.id },
    });

    if (!inv) {
      inv = await prisma.inventory.create({
        data: { pharmacyId: pharmacy.id, medicineId: med.id },
      });
      console.log("Created Inventory for:", med.name);
    }

    // Check Batch
    const batchName = `SEED-${inv.id}`;
    let batch = await prisma.batch.findFirst({
      where: { inventoryId: inv.id, batchNumber: batchName },
    });

    if (!batch) {
      batch = await prisma.batch.create({
        data: {
          inventoryId: inv.id,
          batchNumber: batchName,
          quantity: stockByName[med.name] ?? 50,
          expiryDate: new Date("2099-12-31"),
          isLegacy: true,
        },
      });
      console.log("Created FEFO Batch for:", med.name);
    }
  }

  console.log("\n✅ Safe Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
