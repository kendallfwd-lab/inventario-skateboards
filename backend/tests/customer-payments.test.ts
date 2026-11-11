import assert from 'node:assert/strict';
import test from 'node:test';
import {collectedCents,outstandingCents,refundRemainingCents} from '../src/services/customer-payments.js';

test('distingue pagos recibidos y reembolsos con precisión de centavos',()=>{
  const events=[{event_type:'PAYMENT' as const,amount_crc:'1000.25'},{event_type:'PAYMENT' as const,amount_crc:'250.10'},{event_type:'REFUND' as const,amount_crc:'50.05'}];
  assert.equal(collectedCents(events),120030);
  assert.equal(outstandingCents('1500.00',events),29970);
});

test('impide reembolsar más que el pago original',()=>{
  assert.equal(refundRemainingCents('100.00',[{event_type:'REFUND',amount_crc:'25.00'}]),7500);
  assert.throws(()=>refundRemainingCents('100.00',[{event_type:'REFUND',amount_crc:'100.01'}]),/superan el pago original/);
});

test('rechaza historiales de cobro que sobrepasan el total del pedido',()=>{
  assert.throws(()=>outstandingCents('20.00',[{event_type:'PAYMENT',amount_crc:'20.01'}]),/supera el total del pedido/);
});

test('rechaza montos con más precisión que la moneda registrada',()=>{
  assert.throws(()=>collectedCents([{event_type:'PAYMENT',amount_crc:'1.001'}]),/Monto inválido/);
});
