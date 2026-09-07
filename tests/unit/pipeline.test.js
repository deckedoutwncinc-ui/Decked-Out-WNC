import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, canTransition, canManuallyTransition } from "../../js/pipeline.js";

test("STAGES includes every pipeline stage in order", () => {
  assert.deepEqual(STAGES, [
    "LEAD_IN",
    "BID_SCHEDULED",
    "DESIGN_FEE",
    "BID_GIVEN",
    "WON",
    "LOST",
    "CONTRACT_SENT",
    "CONTRACT_SIGNED",
    "DEPOSIT_INVOICED",
    "DEPOSIT_PAID",
    "JOB_SCHEDULED",
    "IN_PROGRESS",
    "FINAL_INVOICE_SENT",
    "FINAL_PAYMENT_RECEIVED",
    "COMPLETE",
  ]);
});

test("Lead In can advance to Bid Scheduled", () => {
  assert.equal(canTransition("LEAD_IN", "BID_SCHEDULED"), true);
});

test("Bid Scheduled can advance to the optional Design Fee stage", () => {
  assert.equal(canTransition("BID_SCHEDULED", "DESIGN_FEE"), true);
});

test("Bid Scheduled can also skip Design Fee and go straight to Bid Given", () => {
  assert.equal(canTransition("BID_SCHEDULED", "BID_GIVEN"), true);
});

test("Design Fee can only advance to Bid Given", () => {
  assert.equal(canTransition("DESIGN_FEE", "BID_GIVEN"), true);
  assert.equal(canTransition("DESIGN_FEE", "WON"), false);
});

test("Bid Given branches to Won or Lost", () => {
  assert.equal(canTransition("BID_GIVEN", "WON"), true);
  assert.equal(canTransition("BID_GIVEN", "LOST"), true);
});

test("Lost is terminal", () => {
  assert.equal(canTransition("LOST", "CONTRACT_SENT"), false);
  assert.equal(canTransition("LOST", "WON"), false);
});

test("Complete is terminal", () => {
  assert.equal(canTransition("COMPLETE", "LEAD_IN"), false);
});

test("cannot skip stages, e.g. Lead In straight to Job Scheduled", () => {
  assert.equal(canTransition("LEAD_IN", "JOB_SCHEDULED"), false);
});

test("cannot move backwards, e.g. Won back to Bid Given", () => {
  assert.equal(canTransition("WON", "BID_GIVEN"), false);
});

test("unknown stage names never transition", () => {
  assert.equal(canTransition("NOT_A_STAGE", "WON"), false);
  assert.equal(canTransition("LEAD_IN", "NOT_A_STAGE"), false);
});

test("inherited Object properties are never valid stage names", () => {
  assert.equal(canTransition("constructor", "WON"), false);
  assert.equal(canTransition("toString", "WON"), false);
  assert.equal(canTransition("hasOwnProperty", "WON"), false);
});

test("canManuallyTransition excludes the two contract-driven transitions", () => {
  assert.equal(canManuallyTransition("WON", "CONTRACT_SENT"), false);
  assert.equal(canManuallyTransition("CONTRACT_SENT", "CONTRACT_SIGNED"), false);
});

test("canManuallyTransition still allows every other valid transition", () => {
  assert.equal(canManuallyTransition("LEAD_IN", "BID_SCHEDULED"), true);
  assert.equal(canManuallyTransition("CONTRACT_SIGNED", "DEPOSIT_INVOICED"), true);
  assert.equal(canManuallyTransition("BID_GIVEN", "LOST"), true);
});

test("canManuallyTransition still rejects invalid transitions", () => {
  assert.equal(canManuallyTransition("LEAD_IN", "COMPLETE"), false);
});
