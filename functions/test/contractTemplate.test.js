import { test } from "node:test";
import assert from "node:assert/strict";
import { fillContractTemplate } from "../lib/contractTemplate.js";

test("fills in customer name, address, scope, price, and deposit", () => {
  const text = fillContractTemplate({
    customerName: "Jane Doe",
    address: "123 Main St, Asheville, NC",
    scopeOfWork: "Build a 12x14 pressure-treated deck with railing.",
    bidAmount: 12000,
    depositPercent: 30,
    sentDate: "09/07/2026",
  });

  assert.ok(text.includes("Jane Doe"));
  assert.ok(text.includes("123 Main St, Asheville, NC"));
  assert.ok(text.includes("Build a 12x14 pressure-treated deck with railing."));
  assert.ok(text.includes("$12,000.00"));
  assert.ok(text.includes("30%"));
  assert.ok(text.includes("$3,600.00")); // 30% of $12,000
  assert.ok(text.includes("09/07/2026"));
  assert.ok(!text.includes("{{"));
});

test("does not leave any unfilled placeholders", () => {
  const text = fillContractTemplate({
    customerName: "A",
    address: "B",
    scopeOfWork: "C",
    bidAmount: 100,
    depositPercent: 10,
    sentDate: "01/01/2026",
  });
  assert.ok(!text.includes("{{") && !text.includes("}}"));
});
