export type ProductStockSnapshot={
  isAvailable:boolean;
  stockMode:string;
  stockQty:number|null;
  lowStockThreshold:number;
  stockStatus:string;
};

export function productStockSnapshot(po:any,recipeAvailability?:any):ProductStockSnapshot{
  const configured=!!po&&po.isAvailable&&po.isActive&&po.status==='ACTIVE';
  const stockMode=String(po?.stockMode||'UNLIMITED');
  const stockQty=stockMode==='RECIPE'?(recipeAvailability?.canProduce??null):Number(po?.stockQty||0);
  const lowStockThreshold=Number(po?.lowStockThreshold??5);
  if(!configured)return {isAvailable:false,stockMode,stockQty,lowStockThreshold,stockStatus:'SOLD_OUT'};
  if(stockMode==='MANUAL'){
    if(stockQty<=0)return {isAvailable:false,stockMode,stockQty,lowStockThreshold,stockStatus:'OUT_OF_STOCK'};
    return {isAvailable:true,stockMode,stockQty,lowStockThreshold,stockStatus:stockQty<=lowStockThreshold?'LOW_STOCK':'AVAILABLE'};
  }
  if(stockMode==='RECIPE'){
    const recipeStatus=String(recipeAvailability?.status||'RECIPE_MISSING');
    if(recipeStatus==='AVAILABLE'||recipeStatus==='LOW_STOCK')return {isAvailable:true,stockMode,stockQty,lowStockThreshold,stockStatus:Number(stockQty)<=lowStockThreshold?'LOW_STOCK':'AVAILABLE'};
    return {isAvailable:false,stockMode,stockQty,lowStockThreshold,stockStatus:recipeStatus};
  }
  return {isAvailable:true,stockMode,stockQty:null,lowStockThreshold,stockStatus:'AVAILABLE'};
}
