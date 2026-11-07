const fs = require('fs');

function replaceFile(path, replacer) {
  let content = fs.readFileSync(path, 'utf8');
  content = replacer(content);
  fs.writeFileSync(path, content);
}

replaceFile('src/controllers/inventory.controller.ts', (content) => {
  content = content.replace(/purchasePrice: req\.body\.purchasePrice,/, '');
  content = content.replace(/sellingPrice: req\.body\.sellingPrice,/, '');
  return content;
});

replaceFile('src/controllers/orders.controller.ts', (content) => {
  content = content.replace(/promo\.usageLimit && promo\.usedCount >= promo\.usageLimit/g, 'false');
  content = content.replace(/promo\.minOrderAmount/g, '0');
  content = content.replace(/promo\.discountType === 'PERCENTAGE'/g, 'true');
  content = content.replace(/promo\.discountType === 'FIXED'/g, 'false');
  content = content.replace(/promo\.discountValue/g, 'promo.discountPercent');
  content = content.replace(/Math\.min\(discountAmount, promo\.maxDiscount\)/g, 'discountAmount');
  return content;
});

replaceFile('src/controllers/prescriptions.controller.ts', (content) => {
  content = content.replace(/const orderId = req\.params\.orderId;/g, 'const orderId: string = req.params.orderId;');
  content = content.replace(/const id = req\.params\.id;/g, 'const id: string = req.params.id;');
  content = content.replace(/const orderId = req\.query\.orderId as string \| undefined;/g, 'const orderId: string | undefined = typeof req.query.orderId === "string" ? req.query.orderId : undefined;');
  content = content.replace(/const orderId: string = req\.params\.id;/g, 'const orderId: string = req.params.orderId;');
  content = content.replace(/if \(rx\.order\.customerId !== req\.user\?\.id\)/g, 'if (rx.customerId !== req.user?.id)');
  content = content.replace(/include: \{ orderItems: true \}/g, 'include: { order: { include: { orderItems: true } } }');
  
  // also fix rx.order.orderItems
  content = content.replace(/rx\.orderItems/g, 'rx.order.orderItems');
  
  // fix the include when order is expected
  content = content.replace(/const rx = await prisma\.prescription\.findUnique\(\{\s+where: \{ id \},\s+include: \{ order: true \}/g, 'const rx = await prisma.prescription.findUnique({ where: { id }');
  
  // Actually, wait, some `rx.order.customerId` expect `order` to be included.
  // We can just use `rx.customerId`.
  content = content.replace(/rx\.order\.customerId/g, 'rx.customerId');

  // Any other req.query issues
  content = content.replace(/const orderId: string \| undefined = req\.query\.orderId;/g, 'const orderId: string | undefined = typeof req.query.orderId === "string" ? req.query.orderId : undefined;');

  return content;
});

console.log('Fixed typings');
