import { CartItem } from "./cartStore";
import { OrderContext } from "./orderContextStore";

export type HeldOrder = {
  id: string;
  orderId: string;
  cart: CartItem[];
  context: OrderContext;
  time: number;
};

let heldOrders: HeldOrder[] = [];

export const getHeldOrders = () => heldOrders;

export const holdOrder = (
  orderId: string,
  cart: CartItem[],
  context: OrderContext,
) => {
  const order: HeldOrder = {
    id: Date.now().toString(),
    orderId,
    cart: JSON.parse(JSON.stringify(cart)),
    context,
    time: Date.now(),
  };

  heldOrders.push(order);
};

export const removeHeldOrder = (id: string) => {
  heldOrders = heldOrders.filter((o) => o.id !== id);
};
