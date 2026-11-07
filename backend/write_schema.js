const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

// The DB pull messed up relations because it introspected.
// Let's just restore the whole file exactly to my Phase 3 intended schema,
// EXCEPT we ensure we don't lose any Phase 2 models that we had.
// Actually, it's easier to just use the exact valid schema that we had BEFORE `db pull`,
// and then add Prescription. But wait, I tried that and validation failed?
// No, the validation failure earlier was ONLY because I didn't add Prescription models completely correctly.

// Let's write the whole file manually.

const perfectSchema = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  ADMIN
  PHARMACY_ADMIN
  PHARMACIST
  RIDER
  CUSTOMER
}

enum OrderStatus {
  PRESCRIPTION_PENDING
  PAYMENT_PENDING
  PENDING
  ACCEPTED
  OUT_FOR_DELIVERY
  DELIVERED
  CANCELLED
}

model User {
  id            String   @id @default(cuid())
  role          UserRole
  phone_number  String   @unique
  full_name     String
  password_hash String
  createdAt     DateTime @default(now())

  pharmacyId String?
  pharmacy   Pharmacy? @relation("PharmacyStaff", fields: [pharmacyId], references: [id])
  inventoryTransactions InventoryTransaction[]
  customerPrescriptions Prescription[] @relation("PrescriptionCustomer")
  pharmacistPrescriptions Prescription[] @relation("PrescriptionPharmacist")
  orders     Order[] @relation("OrderCustomer")
  deliveries Order[] @relation("OrderRider")

  @@index([role])
  @@index([pharmacyId])
}

model Pharmacy {
  id        String @id @default(cuid())
  name      String
  latitude  Float
  longitude Float

  inventory Inventory[]
  orders    Order[]
  staff     User[] @relation("PharmacyStaff")

  @@index([name])
}

model Medicine {
  id                    String  @id @default(cuid())
  name                  String
  generic_name          String
  price                 Decimal @db.Decimal(12, 2)
  manufacturer          String
  requires_prescription Boolean @default(false)
  stock_quantity        Int     @default(0) // Legacy global stock

  inventory Inventory[]
}

model Inventory {
  id         String   @id @default(cuid())
  pharmacyId String
  medicineId String

  pharmacy Pharmacy @relation(fields: [pharmacyId], references: [id], onDelete: Cascade)
  medicine Medicine @relation(fields: [medicineId], references: [id], onDelete: Cascade)

  batches Batch[]

  @@unique([pharmacyId, medicineId])
  @@index([pharmacyId])
  @@index([medicineId])
}

model Batch {
  id          String   @id @default(cuid())
  inventoryId String
  batchNumber String
  expiryDate  DateTime
  isLegacy    Boolean  @default(false)
  quantity    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  inventory Inventory @relation(fields: [inventoryId], references: [id], onDelete: Cascade)
  allocations OrderItemBatchAllocation[]
  transactions InventoryTransaction[]

  @@unique([inventoryId, batchNumber])
  @@index([inventoryId])
  @@index([expiryDate])
}

model Order {
  id               String      @id @default(cuid())
  customerId       String
  pharmacyId       String
  riderId          String?
  status           OrderStatus @default(PENDING)
  total_amount     Decimal     @db.Decimal(12, 2)
  delivery_address String?
  delivery_lat     Float?
  delivery_lng     Float?
  createdAt        DateTime    @default(now())
  rating           Int?
  feedback         String?

  customer      User           @relation("OrderCustomer", fields: [customerId], references: [id], onDelete: Restrict)
  pharmacy      Pharmacy       @relation(fields: [pharmacyId], references: [id], onDelete: Restrict)
  rider         User?          @relation("OrderRider", fields: [riderId], references: [id], onDelete: Restrict)
  orderItems    OrderItem[]
  payment       Payment?
  prescriptions Prescription[]

  @@index([customerId])
  @@index([pharmacyId])
  @@index([riderId])
}

model OrderItem {
  id         String  @id @default(cuid())
  orderId    String
  medicineId String
  quantity   Int
  unit_price Decimal @db.Decimal(12, 2)

  order    Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  medicine Medicine @relation(fields: [medicineId], references: [id], onDelete: Restrict)
  allocations OrderItemBatchAllocation[]

  @@index([orderId])
  @@index([medicineId])
}

model OrderItemBatchAllocation {
  id          String @id @default(cuid())
  orderItemId String
  batchId     String
  quantity    Int

  orderItem OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)
  batch     Batch     @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@unique([orderItemId, batchId])
  @@index([orderItemId])
  @@index([batchId])
}

enum InventoryTransactionType {
  PURCHASE
  ORDER
  RETURN
  CANCELLATION
  ADJUSTMENT
  DAMAGED
  EXPIRED
}

model InventoryTransaction {
  id              String                   @id @default(cuid())
  batchId         String
  quantityDelta   Int
  transactionType InventoryTransactionType
  referenceId     String?
  performedById   String

  batch       Batch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  performedBy User  @relation(fields: [performedById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@index([batchId])
  @@index([performedById])
  @@index([referenceId])
}

model Payment {
  id            String   @id @default(cuid())
  orderId       String   @unique
  amount        Decimal  @db.Decimal(12, 2)
  method        String
  status        String   @default("PENDING")
  transactionId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId])
}

model Session {
  id        String   @id
  sid       String   @unique
  data      String
  expiresAt DateTime
}

model PromoCode {
  id              String   @id @default(cuid())
  code            String   @unique
  discountPercent Int
  active          Boolean  @default(true)
  expiresAt       DateTime?
  createdAt       DateTime @default(now())
}

enum PrescriptionStatus {
  PENDING
  APPROVED
  REJECTED
}

model Prescription {
  id               String             @id @default(cuid())
  orderId          String
  customerId       String
  storageKey       String
  originalFilename String
  mimeType         String
  fileSize         Int
  status           PrescriptionStatus @default(PENDING)
  pharmacistId     String?
  notes            String?
  ocrText          String?
  aiSuggestions    Json?
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt

  order            Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  customer         User   @relation("PrescriptionCustomer", fields: [customerId], references: [id], onDelete: Cascade)
  pharmacist       User?  @relation("PrescriptionPharmacist", fields: [pharmacistId], references: [id], onDelete: SetNull)

  @@index([orderId])
  @@index([customerId])
  @@index([pharmacistId])
  @@index([status])
}
`;

fs.writeFileSync('prisma/schema.prisma', perfectSchema);
console.log('Successfully wrote the perfect schema!');
