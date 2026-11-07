const fs = require('fs');
let s = fs.readFileSync('prisma/schema.prisma', 'utf8');

s = s.replace(/Order_Order_customerIdToUser\s+Order\[\]\s+@relation\("Order_customerIdToUser"\)/g, 'orders Order[] @relation("OrderCustomer")');
s = s.replace(/Order_Order_riderIdToUser\s+Order\[\]\s+@relation\("Order_riderIdToUser"\)/g, 'deliveries Order[] @relation("OrderRider")');
s = s.replace(/Prescription_Prescription_customerIdToUser\s+Prescription\[\]\s+@relation\("Prescription_customerIdToUser"\)/g, 'customerPrescriptions Prescription[] @relation("PrescriptionCustomer")');
s = s.replace(/Prescription_Prescription_pharmacistIdToUser\s+Prescription\[\]\s+@relation\("Prescription_pharmacistIdToUser"\)/g, 'pharmacistPrescriptions Prescription[] @relation("PrescriptionPharmacist")');
s = s.replace(/InventoryTransaction\s+InventoryTransaction\[\]/g, 'inventoryTransactions InventoryTransaction[]');
s = s.replace(/Pharmacy\s+Pharmacy\?\s+@relation\(fields: \[pharmacyId\], references: \[id\]\)/g, 'pharmacy Pharmacy? @relation(fields: [pharmacyId], references: [id])');

// Also fix Order relations if they got mangled
s = s.replace(/User_Order_customerIdToUser\s+User\s+@relation\("Order_customerIdToUser", fields: \[customerId\], references: \[id\], onDelete: Restrict\)/g, 'customer User @relation("OrderCustomer", fields: [customerId], references: [id], onDelete: Restrict)');
s = s.replace(/User_Order_riderIdToUser\s+User\?\s+@relation\("Order_riderIdToUser", fields: \[riderId\], references: \[id\], onDelete: Restrict\)/g, 'rider User? @relation("OrderRider", fields: [riderId], references: [id], onDelete: Restrict)');

// Also fix Prescription relations if they got mangled
s = s.replace(/User_Prescription_customerIdToUser\s+User\s+@relation\("Prescription_customerIdToUser", fields: \[customerId\], references: \[id\], onDelete: Cascade\)/g, 'customer User @relation("PrescriptionCustomer", fields: [customerId], references: [id], onDelete: Cascade)');
s = s.replace(/User_Prescription_pharmacistIdToUser\s+User\?\s+@relation\("Prescription_pharmacistIdToUser", fields: \[pharmacistId\], references: \[id\], onDelete: SetNull\)/g, 'pharmacist User? @relation("PrescriptionPharmacist", fields: [pharmacistId], references: [id], onDelete: SetNull)');

fs.writeFileSync('prisma/schema.prisma', s);
console.log('Fixed User/Order/Prescription relations');
