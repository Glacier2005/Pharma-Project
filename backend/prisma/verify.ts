import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log('Pharmacies:', await prisma.pharmacy.count());
  console.log('Inventories:', await prisma.inventory.count());
  console.log('Batches:', await prisma.batch.count());
  console.log('Users:', await prisma.user.count());
  console.log('Orders:', await prisma.order.count());
  console.log('Payments:', await prisma.payment.count());
  console.log('Prescriptions:', await prisma.prescription.count());
}

main().finally(() => prisma.$disconnect());
