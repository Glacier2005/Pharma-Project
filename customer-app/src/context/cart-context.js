import { createContext, useContext } from 'react';
export const CartCtx = createContext(null);
export const useCart = () => useContext(CartCtx);
