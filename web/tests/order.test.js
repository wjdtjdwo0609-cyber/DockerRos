// Pure-domain tests for production-flow/Order.
// Run with: node --test web/tests/order.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProductionOrder,
  hasOrderItems,
  OrderStatus,
} from '../src/domains/production-flow/domain/Order.js';

test('OrderStatus has the three lifecycle values', () => {
  assert.deepEqual(
    Object.values(OrderStatus).sort(),
    ['done', 'pending', 'running'],
  );
});

test('hasOrderItems returns false when both counts are zero or absent', () => {
  assert.equal(hasOrderItems(), false);
  assert.equal(hasOrderItems({}), false);
  assert.equal(hasOrderItems({ socket8: 0, socket12: 0 }), false);
});

test('hasOrderItems returns true if either count is positive', () => {
  assert.equal(hasOrderItems({ socket8: 1 }), true);
  assert.equal(hasOrderItems({ socket12: 1 }), true);
  assert.equal(hasOrderItems({ socket8: 3, socket12: 2 }), true);
});

test('createProductionOrder fills sensible defaults and totals counts', () => {
  const before = new Date('2026-01-01T00:00:00Z');
  const order = createProductionOrder({ socket8: 3, socket12: 2, createdAt: before });
  assert.equal(order.socket8, 3);
  assert.equal(order.socket12, 2);
  assert.equal(order.total, 5);
  assert.equal(order.status, OrderStatus.PENDING);
  assert.equal(order.createdAt, before);
  assert.ok(Number.isInteger(order.id) && order.id > 0);
});

test('createProductionOrder assigns monotonically increasing IDs', () => {
  const a = createProductionOrder({ socket8: 1 });
  const b = createProductionOrder({ socket8: 1 });
  assert.ok(b.id > a.id, `expected ${b.id} > ${a.id}`);
});

test('createProductionOrder works with no arguments', () => {
  const order = createProductionOrder();
  assert.equal(order.socket8, 0);
  assert.equal(order.socket12, 0);
  assert.equal(order.total, 0);
  assert.equal(order.status, OrderStatus.PENDING);
  assert.ok(order.createdAt instanceof Date);
});
