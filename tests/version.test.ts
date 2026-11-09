import { describe,it,expect } from 'vitest';
import { compareVersions,isBelowMinimum,isVersion } from '../src/version';
describe('comparing versions',()=>{
  it('compares number by number, not as text',()=>{
    expect(isBelowMinimum('0.9.0','0.10.0')).toBe(true);
    expect(isBelowMinimum('0.10.0','0.9.0')).toBe(false);
    expect(isBelowMinimum('0.2.0','0.10.0')).toBe(true);
    expect(isBelowMinimum('9.0.0','10.0.0')).toBe(true);
    expect(isBelowMinimum('1.0.0','0.99.99')).toBe(false);
  });
  it.each([['0.2.0','0.2.0'],['0.2','0.2.0'],['0.2.0.0','0.2.0'],['0.2.1','0.2.0'],['0.2.0.1','0.2.0'],['0.3','0.2.9']])('%s meets %s',(have,need)=>expect(isBelowMinimum(have,need)).toBe(false));
  it.each([['0.1.9','0.2.0'],['0.2','0.2.1'],['0.2.0','0.2.0.1']])('%s is below %s',(have,need)=>expect(isBelowMinimum(have,need)).toBe(true));
  it('orders in both directions, and calls equal versions equal',()=>{
    expect(compareVersions([0,10,0],[0,9,0])).toBeGreaterThan(0);expect(compareVersions([0,9,0],[0,10,0])).toBeLessThan(0);expect(compareVersions([1,2],[1,2,0])).toBe(0);
  });
  it.each<[unknown,unknown]>([['0.2.0',undefined],['0.2.0',null],['0.2.0','latest'],['0.2.0','1.0.0-beta.1'],['0.2.0','v1.0.0'],['0.2.0',''],['0.2.0',5],[undefined,'0.2.0'],['x','0.2.0'],['0.2.0','1.2.3.4.5']])('a value that is not a version never raises the notice: %j, %j',(have,need)=>expect(isBelowMinimum(have,need)).toBe(false));
  it('recognizes a version',()=>{expect(isVersion('0.10.0')).toBe(true);expect(isVersion('0.10.0-beta')).toBe(false);expect(isVersion(1)).toBe(false);});
});
