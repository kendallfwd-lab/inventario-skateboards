import assert from 'node:assert/strict';
import test from 'node:test';
import {amountToCents,promotionDiscountCents} from '../src/services/promotions.js';

test('calcula porcentajes con redondeo exacto a centavos',()=>{
  assert.equal(promotionDiscountCents({subtotalCents:9999,minimumSubtotal:'0.00',type:'PERCENTAGE',value:'10.00'}),1000);
  assert.equal(promotionDiscountCents({subtotalCents:1001,minimumSubtotal:'0.00',type:'PERCENTAGE',value:'12.50'}),125);
});

test('limita descuentos fijos al subtotal y respeta el mínimo de compra',()=>{
  assert.equal(promotionDiscountCents({subtotalCents:3500,minimumSubtotal:'25.00',type:'FIXED',value:'50.00'}),3500);
  assert.throws(()=>promotionDiscountCents({subtotalCents:2499,minimumSubtotal:'25.00',type:'FIXED',value:'5.00'}),/no alcanza el mínimo/);
});

test('rechaza valores monetarios con más de dos decimales y porcentajes superiores a 100',()=>{
  assert.throws(()=>amountToCents('10.001'),/hasta dos decimales/);
  assert.throws(()=>promotionDiscountCents({subtotalCents:1000,minimumSubtotal:'0.00',type:'PERCENTAGE',value:'100.01'}),/Porcentaje/);
});
