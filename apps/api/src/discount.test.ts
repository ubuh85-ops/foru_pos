import {describe,expect,it} from 'vitest';
import {discountAmount} from './discount.js';
describe('discountAmount',()=>{it('calculates percentage',()=>expect(discountAmount(100000,{type:'PERCENTAGE',value:10})).toBe(10000));it('caps nominal at base',()=>expect(discountAmount(12000,{type:'NOMINAL',value:20000})).toBe(12000));it('rejects percentage above 100',()=>expect(()=>discountAmount(100,{type:'PERCENTAGE',value:101})).toThrow());});
