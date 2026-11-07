const fs = require('fs');
let s = fs.readFileSync('prisma/schema.prisma', 'utf8');

// Add User relations
const userFind = '  inventoryTransactions InventoryTransaction[]\r\n\r\n  @@index([role])';
const userReplace = '  inventoryTransactions InventoryTransaction[]\r\n  customerPrescriptions Prescription[] @relation("PrescriptionCustomer")\r\n  pharmacistPrescriptions Prescription[] @relation("PrescriptionPharmacist")\r\n\r\n  @@index([role])';
s = s.replace(userFind, userReplace);
// Also try LF version
s = s.replace(userFind.replace(/\r/g, ''), userReplace.replace(/\r/g, ''));

const modelString = `\n
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

if (!s.includes('model Prescription')) {
  s += modelString;
}

fs.writeFileSync('prisma/schema.prisma', s);
console.log('Schema updated via script');
