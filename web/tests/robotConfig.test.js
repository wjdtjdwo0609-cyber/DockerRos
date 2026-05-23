// Shape sanity tests for robot-control/robotConfig.
// Catches accidental edits to the kinematic chain definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROBOT_CONFIG } from '../src/domains/robot-control/domain/robotConfig.js';

const EXPECTED_ROBOTS = ['indy7', 'indy12', 'ur5e', 'ur10e', 'panda', 'fanuc'];

test('ROBOT_CONFIG exposes every supported robot', () => {
  for (const name of EXPECTED_ROBOTS) {
    assert.ok(ROBOT_CONFIG[name], `missing config for ${name}`);
  }
});

test('every robot config has a non-empty chain and a tcp link name', () => {
  for (const [name, cfg] of Object.entries(ROBOT_CONFIG)) {
    assert.ok(Array.isArray(cfg.chain), `${name}.chain must be an array`);
    assert.ok(cfg.chain.length >= 6, `${name}.chain expected ≥6 joints, got ${cfg.chain.length}`);
    assert.equal(typeof cfg.tcp, 'string', `${name}.tcp must be a string`);
    assert.ok(cfg.tcp.length > 0, `${name}.tcp must not be empty`);
  }
});

test('chain joint names are unique within each robot', () => {
  for (const [name, cfg] of Object.entries(ROBOT_CONFIG)) {
    const unique = new Set(cfg.chain);
    assert.equal(unique.size, cfg.chain.length, `${name} has duplicate joint names`);
  }
});

test('Panda is a 7-DOF arm (the only one)', () => {
  assert.equal(ROBOT_CONFIG.panda.chain.length, 7);
  for (const name of EXPECTED_ROBOTS) {
    if (name === 'panda') continue;
    assert.equal(ROBOT_CONFIG[name].chain.length, 6, `${name} expected 6-DOF`);
  }
});
