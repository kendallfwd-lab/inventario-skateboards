export function calculateReorder(avg:number,max:number,lead:number){if(avg<0||max<avg||lead<0)throw new Error('Política de reposición inválida');const safety=(max-avg)*lead;return {safetyStock:safety,reorderPoint:avg*lead+safety};}
export function activeAlert(stock:number,point:number){return stock<=point;}
