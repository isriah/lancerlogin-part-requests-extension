import { describe, expect, it } from 'vitest';
import { cleanPacks, MAX_PACKS, packKeyFor, packSizes, rememberPacks, type PackMemory } from '../../src/carts/packs';
import type { ItemResult } from '../../src/carts/runner';
import { groupOrders, packNote, rowFor, summarize } from '../../src/carts/selection';
import { andymark } from '../../src/carts/stores/andymark';
import { rev } from '../../src/carts/stores/rev';
import { order } from './helpers';

const am = (extra = {}) => order({ vendor: 'AndyMark', urlVendor: 'AndyMark', sku: 'AM-TEST-25', productUrl: 'https://andymark.com/products/test-screw', quantity: 1, unitPrice: 0.05, ...extra });
const KEY = 'andymark:test-screw|am-test-25';
const item = (extra: Partial<ItemResult> = {}): ItemResult => ({ order: am(), outcome: 'added', message: '', confirmed: true, ...extra });
const none = new Map<string, boolean>();

describe('remembering pack sizes', () => {
  it('keys a product by store, link handle and SKU, and only for a store that sells in packs', () => {
    expect(packKeyFor(andymark, am())).toBe(KEY);
    expect(packKeyFor(rev, order())).toBeNull();
  });
  it('keeps what a build read, 1 included, and leaves a line it couldn\'t read alone', () => {
    let memory: PackMemory = {};
    memory = rememberPacks(memory, andymark, { items: [item({ soldIn: 25 })] }, 1000);
    expect(memory).toEqual({ [KEY]: { soldIn: 25, seenMs: 1000 } });
    memory = rememberPacks(memory, andymark, { items: [item()] }, 2000);
    expect(memory[KEY]).toEqual({ soldIn: 25, seenMs: 1000 });
    memory = rememberPacks(memory, andymark, { items: [item({ soldIn: 1 })] }, 3000);
    expect(memory[KEY]).toEqual({ soldIn: 1, seenMs: 3000 });
  });
  it('holds nothing about who asked: no order ID, requester, team, description or Notion link', () => {
    const memory = rememberPacks({}, andymark, { items: [item({ soldIn: 25, order: am({ id: 'order-secret', requesters: ['Test Student A'], teams: ['Test Team'], description: 'Secret description', url: 'https://example.test/notion-row' }) })] }, 1);
    const text = JSON.stringify(memory);
    for (const word of ['order-secret', 'Test Student A', 'Test Team', 'Secret description', 'notion-row']) expect(text).not.toContain(word);
  });
  it('keeps only the newest when there are too many', () => {
    const many: PackMemory = Object.fromEntries(Array.from({ length: MAX_PACKS }, (_, n) => [`andymark:old-${n}|x`, { soldIn: 2, seenMs: n }]));
    const memory = rememberPacks(many, andymark, { items: [item({ soldIn: 25 })] }, 10 ** 9);
    expect(Object.keys(memory)).toHaveLength(MAX_PACKS);
    expect(memory[KEY]).toBeDefined();
    expect(memory['andymark:old-0|x']).toBeUndefined();
  });
  it('drops anything malformed that storage held', () => {
    expect(cleanPacks(null)).toEqual({});
    expect(cleanPacks([1])).toEqual({});
    expect(cleanPacks({ [KEY]: { soldIn: 25, seenMs: 1, extra: 'x' }, a: { soldIn: 0, seenMs: 1 }, b: { soldIn: 2.5, seenMs: 1 }, c: 'x', d: { soldIn: 3 } })).toEqual({ [KEY]: { soldIn: 25, seenMs: 1 } });
  });
});

describe('the estimate before a build', () => {
  it('without a pack size, uses the requested quantity and says it may round up', () => {
    const groups = groupOrders([am({ id: 'a' })]);
    expect(packNote(groups[0].rows[0], new Map())).toEqual({ kind: 'unknown' });
    expect(summarize(groups, none, new Map())).toMatchObject({ estimate: 0.05, mayRound: 1, packRounded: 0 });
  });
  it('with a pack size from the last build, counts whole packs', () => {
    const packs = packSizes({ [KEY]: { soldIn: 25, seenMs: 1 } });
    const groups = groupOrders([am({ id: 'a' })]);
    expect(packNote(groups[0].rows[0], packs)).toEqual({ kind: 'known', soldIn: 25 });
    const summary = summarize(groups, none, packs);
    expect(summary.estimate).toBeCloseTo(25 * 0.05);
    expect(summary).toMatchObject({ mayRound: 0, packRounded: 1 });
  });
  it('rounds orders that share a part together, as a build does', () => {
    const packs = new Map([[KEY, 25]]);
    expect(summarize(groupOrders([am({ id: 'a' }), am({ id: 'b' })]), none, packs).estimate).toBeCloseTo(25 * 0.05);
    expect(summarize(groupOrders([am({ id: 'a', quantity: 20 }), am({ id: 'b', quantity: 10 })]), none, packs).estimate).toBeCloseTo(50 * 0.05);
    expect(summarize(groupOrders([am({ id: 'a', quantity: 25 })]), none, packs)).toMatchObject({ packRounded: 0 });
    expect(summarize(groupOrders([am({ id: 'a', quantity: 25 })]), none, packs).estimate).toBeCloseTo(25 * 0.05);
  });
  it('counts only ticked orders toward a shared pack', () => {
    const groups = groupOrders([am({ id: 'a', quantity: 20 }), am({ id: 'b', quantity: 10 })]);
    expect(summarize(groups, new Map([['b', false]]), new Map([[KEY, 25]])).estimate).toBeCloseTo(25 * 0.05);
  });
  it('a pack of 1 needs no note and changes nothing', () => {
    const groups = groupOrders([am({ id: 'a', quantity: 3 })]);
    expect(packNote(groups[0].rows[0], new Map([[KEY, 1]]))).toBeNull();
    expect(summarize(groups, none, new Map([[KEY, 1]]))).toMatchObject({ estimate: 0.15000000000000002, mayRound: 0, packRounded: 0 });
  });
  it('says nothing about packs for a store that has none, or a row that can\'t be ticked', () => {
    expect(packNote(rowFor(order()), new Map())).toBeNull();
    expect(packNote(rowFor(am({ sku: null })), new Map())).toBeNull();
    expect(summarize(groupOrders([order({ quantity: 2, unitPrice: 10 })]), none, new Map())).toMatchObject({ estimate: 20, mayRound: 0 });
  });
});
