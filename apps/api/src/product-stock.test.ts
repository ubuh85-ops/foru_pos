import {describe,expect,it} from 'vitest';
import {productStockSnapshot} from './product-stock.js';

const base={isAvailable:true,isActive:true,status:'ACTIVE',lowStockThreshold:5};

describe('productStockSnapshot',()=>{
  it('keeps existing products unlimited and available',()=>{
    expect(productStockSnapshot({...base,stockMode:'UNLIMITED',stockQty:0})).toMatchObject({isAvailable:true,stockQty:null,stockStatus:'AVAILABLE'});
  });
  it('marks manual stock as low and out of stock',()=>{
    expect(productStockSnapshot({...base,stockMode:'MANUAL',stockQty:3})).toMatchObject({isAvailable:true,stockStatus:'LOW_STOCK'});
    expect(productStockSnapshot({...base,stockMode:'MANUAL',stockQty:0})).toMatchObject({isAvailable:false,stockStatus:'OUT_OF_STOCK'});
  });
  it('uses recipe production capacity',()=>{
    expect(productStockSnapshot({...base,stockMode:'RECIPE'},{status:'LOW_STOCK',canProduce:4})).toMatchObject({isAvailable:true,stockQty:4,stockStatus:'LOW_STOCK'});
    expect(productStockSnapshot({...base,stockMode:'RECIPE'},{status:'OUT_OF_STOCK',canProduce:0})).toMatchObject({isAvailable:false,stockQty:0,stockStatus:'OUT_OF_STOCK'});
  });
  it('honors the manual availability toggle for every mode',()=>{
    expect(productStockSnapshot({...base,isAvailable:false,stockMode:'MANUAL',stockQty:10})).toMatchObject({isAvailable:false,stockStatus:'SOLD_OUT'});
  });
});
