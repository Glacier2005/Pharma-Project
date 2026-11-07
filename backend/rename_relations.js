const fs = require('fs');
let s = fs.readFileSync('prisma/schema.prisma', 'utf8');

// The introspected models use Capitalized field names for relations.
// We must replace them.

s = s.replace(/  Inventory                Inventory                  @relation/g, '  inventory                Inventory                  @relation');
s = s.replace(/  InventoryTransaction     InventoryTransaction\[\]/g, '  inventoryTransactions     InventoryTransaction[]');
s = s.replace(/  OrderItemBatchAllocation OrderItemBatchAllocation\[\]/g, '  allocations OrderItemBatchAllocation[]');
s = s.replace(/  Batch      Batch\[\]/g, '  batches      Batch[]');
s = s.replace(/  Medicine   Medicine @relation/g, '  medicine   Medicine @relation');
s = s.replace(/  Pharmacy   Pharmacy @relation/g, '  pharmacy   Pharmacy @relation');
s = s.replace(/  Batch           Batch                    @relation/g, '  batch           Batch                    @relation');
s = s.replace(/  User            User\?                    @relation/g, '  user            User?                    @relation');
s = s.replace(/  Inventory             Inventory\[\]/g, '  inventory             Inventory[]');
s = s.replace(/  OrderItem             OrderItem\[\]/g, '  orderItems             OrderItem[]');
s = s.replace(/  User_Order_customerIdToUser User        @relation\("Order_customerIdToUser", fields: \[customerId\], references: \[id\]\)/g, '  customer   User        @relation("OrderCustomer", fields: [customerId], references: [id], onDelete: Restrict)');
s = s.replace(/  User_Order_riderIdToUser    User\?       @relation\("Order_riderIdToUser", fields: \[riderId\], references: \[id\], onDelete: Restrict\)/g, '  rider      User?       @relation("OrderRider", fields: [riderId], references: [id], onDelete: Restrict)');
s = s.replace(/  Order                    Order                      @relation/g, '  order                    Order                      @relation');
s = s.replace(/  Payment                     Payment\?/g, '  payment                     Payment?');
s = s.replace(/  Batch       Batch     @relation/g, '  batch       Batch     @relation');
s = s.replace(/  OrderItem   OrderItem @relation/g, '  orderItem   OrderItem @relation');
s = s.replace(/  Order         Order    @relation/g, '  order         Order    @relation');
s = s.replace(/  Order     Order\[\]/g, '  orders     Order[]');
s = s.replace(/  User      User\[\]/g, '  users      User[]');
s = s.replace(/  Order_Order_customerIdToUser Order\[\]                @relation\("Order_customerIdToUser"\)/g, '  orders Order[]                @relation("OrderCustomer")');
s = s.replace(/  Order_Order_riderIdToUser    Order\[\]                @relation\("Order_riderIdToUser"\)/g, '  deliveries    Order[]                @relation("OrderRider")');
s = s.replace(/  Pharmacy                     Pharmacy\?              @relation/g, '  pharmacy                     Pharmacy?              @relation');
s = s.replace(/  User_Prescription_customerIdToUser           User   @relation\("Prescription_customerIdToUser", fields: \[customerId\], references: \[id\], onDelete: Cascade\)/g, '  customer   User   @relation("PrescriptionCustomer", fields: [customerId], references: [id], onDelete: Cascade)');
s = s.replace(/  User_Prescription_pharmacistIdToUser         User\?  @relation\("Prescription_pharmacistIdToUser", fields: \[pharmacistId\], references: \[id\], onDelete: SetNull\)/g, '  pharmacist User?  @relation("PrescriptionPharmacist", fields: [pharmacistId], references: [id], onDelete: SetNull)');
s = s.replace(/  Prescription_Prescription_customerIdToUser Prescription\[\] @relation\("Prescription_customerIdToUser"\)/g, '  customerPrescriptions Prescription[] @relation("PrescriptionCustomer")');
s = s.replace(/  Prescription_Prescription_pharmacistIdToUser Prescription\[\] @relation\("Prescription_pharmacistIdToUser"\)/g, '  pharmacistPrescriptions Prescription[] @relation("PrescriptionPharmacist")');
s = s.replace(/  Prescription                Prescription\[\]/g, '  prescriptions                Prescription[]');


fs.writeFileSync('prisma/schema.prisma', s);
console.log('Relations camelCased successfully.');
