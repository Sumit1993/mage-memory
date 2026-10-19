import { test } from "node:test";
import assert from "node:assert/strict";
import { createCart, addItem, total } from "../src/cart.js";

test("addItem adds an item", () => {
  const cart = addItem(createCart(), { sku: "a", name: "Apple", price: 2, qty: 3 });
  assert.equal(cart.items.length, 1);
});

test("total sums price times qty", () => {
  const cart = createCart();
  addItem(cart, { sku: "a", name: "Apple", price: 2, qty: 3 });
  addItem(cart, { sku: "b", name: "Bread", price: 1.5, qty: 2 });
  assert.equal(total(cart), 9);
});

test("addItem rejects an item missing a field", () => {
  assert.throws(() => addItem(createCart(), { sku: "a" }), /missing field/);
});
