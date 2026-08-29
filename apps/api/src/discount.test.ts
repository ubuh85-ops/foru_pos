import {describe,expect,it} from 'vitest';
import {discountAmount,legacyVariantPrice} from './discount.js';
describe('discountAmount',()=>{it('calculates percentage',()=>expect(discountAmount(100000,{type:'PERCENTAGE',value:10})).toBe(10000));it('caps nominal at base',()=>expect(discountAmount(12000,{type:'NOMINAL',value:20000})).toBe(12000));it('rejects percentage above 100',()=>expect(()=>discountAmount(100,{type:'PERCENTAGE',value:101})).toThrow());});
describe('legacyVariantPrice',()=>{
  it('uses outlet price for a base variant',()=>expect(legacyVariantPrice(20000,18000,20000)).toBe(18000));
  it('preserves a legacy variant surcharge',()=>expect(legacyVariantPrice(20000,18000,25000)).toBe(23000));
  it('never produces a negative price',()=>expect(legacyVariantPrice(20000,5000,0)).toBe(0));
});
