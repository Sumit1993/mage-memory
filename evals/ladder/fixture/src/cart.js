import { AppError } from "./errors.js";
import { ITEM_FIELDS } from "../generated/schema.js";

export function createCart() {
  return { items: [] };
}

export function addItem(cart, item) {
  for (const field of ITEM_FIELDS) {
    if (item[field] === undefined) throw new AppError(`missing field: ${field}`, "BAD_ITEM");
  }
  cart.items.push({ ...item });
  return cart;
}

export function total(cart) {
  const sum = cart.items.reduce((acc, it) => acc + it.price * it.qty, 0);
  return Math.floor(sum * 100) / 100;
}
