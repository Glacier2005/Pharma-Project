const fs = require('fs');

let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

if (!schema.includes('PRESCRIPTION_PENDING')) {
  schema = schema.replace('enum OrderStatus {\n', 'enum OrderStatus {\n  PRESCRIPTION_PENDING\n');
}

if (!schema.includes('prescriptions Prescription[]')) {
  schema = schema.replace('  orderItems OrderItem[]', '  orderItems OrderItem[]\n  prescriptions Prescription[]');
}

if (!schema.includes('customerPrescriptions Prescription[]')) {
  schema = schema.replace('  inventoryTransactions InventoryTransaction[]', '  inventoryTransactions InventoryTransaction[]\n  customerPrescriptions Prescription[] @relation("PrescriptionCustomer")\n  pharmacistPrescriptions Prescription[] @relation("PrescriptionPharmacist")');
}

if (!schema.includes('model Prescription {')) {
  schema += `\n
enum PrescriptionStatus {
  PENDING
  APPROVED
  REJECTED
}

model Prescription {
  id               String   @id @default(cuid())
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
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  order            Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  customer         User     @relation("PrescriptionCustomer", fields: [customerId], references: [id], onDelete: Cascade)
  pharmacist       User?    @relation("PrescriptionPharmacist", fields: [pharmacistId], references: [id], onDelete: SetNull)

  @@index([orderId])
  @@index([customerId])
  @@index([pharmacistId])
  @@index([status])
}
`;
}

fs.writeFileSync('prisma/schema.prisma', schema);
console.log('Schema updated successfully');
