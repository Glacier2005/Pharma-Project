import { useState, useCallback, useEffect } from 'react';

import { CartCtx } from './cart-context';

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pd_cart') ?? '[]');
      return Array.isArray(saved) ? saved.filter(i => i?.medicine?.id && Number.isFinite(Number(i.medicine.price)) && Number.isSafeInteger(i.quantity) && i.quantity > 0) : [];
    }
    catch { return []; }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem('pd_cart', JSON.stringify(items)); } catch { /* Storage may be unavailable. */ }
  }, [items]);

  const addItem = useCallback((medicine, quantity = 1) => {
    if (!medicine?.id || !Number.isSafeInteger(quantity) || quantity < 1) return;
    setItems(prev => {
      const ex = prev.find(i => i.medicine.id === medicine.id);
      if (ex) return prev.map(i => i.medicine.id === medicine.id ? { ...i, quantity: i.quantity + quantity } : i);
      return [...prev, { medicine, quantity }];
    });
  }, []);

  const removeItem = useCallback((id) => setItems(prev => prev.filter(i => i.medicine.id !== id)), []);

  const updateQty = useCallback((id, qty) => {
    if (!Number.isSafeInteger(qty) || qty < 1) return;
    setItems(prev => prev.map(i => i.medicine.id === id ? { ...i, quantity: qty } : i));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const total = items.reduce((s, i) => s + parseFloat(i.medicine.price) * i.quantity, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <CartCtx.Provider value={{ items, open, setOpen, addItem, removeItem, updateQty, clearCart, total, count }}>
      {children}
    </CartCtx.Provider>
  );
}
