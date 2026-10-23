import {describe,expect,it} from 'vitest';
import {nextManilaSixAm, isManilaQuietHour, smsSegments, deliveryState, completeDeliveryProof, canReceiveSms, gatewaySelection, isStopMessage} from '../../../supabase/functions/_shared/smsDelivery';

describe('SMS dispatch and receipt safety',()=>{
 it('resumes at the next Manila 06:00 without an extra day',()=>{
  expect(nextManilaSixAm(new Date('2026-10-05T21:00:00Z'))).toBe('2026-10-05T22:00:00.000Z');
  expect(nextManilaSixAm(new Date('2026-10-05T13:00:00Z'))).toBe('2026-10-05T22:00:00.000Z');
  expect(nextManilaSixAm(new Date('2026-12-31T13:00:00Z'))).toBe('2026-12-31T22:00:00.000Z');
 });
 it('uses the inclusive 20:00 and exclusive 06:00 quiet period',()=>{
  expect(isManilaQuietHour(new Date('2026-10-05T12:00:00Z'))).toBe(true);
  expect(isManilaQuietHour(new Date('2026-10-05T22:00:00Z'))).toBe(false);
 });
 it('counts GSM extensions and UTF-16 multipart units',()=>{
  expect(smsSegments('A'.repeat(161))).toMatchObject({encoding:'GSM-7',segments:2});
  expect(smsSegments('^'.repeat(81)).segments).toBe(2);
  expect(smsSegments('🌱'.repeat(36))).toMatchObject({encoding:'Unicode',segments:2});
 });
 it('never treats unknown, queued or partial delivery as delivered',()=>{
  expect(deliveryState('Pending')).toBe(null);expect(deliveryState('Processed')).toBe(null);
  expect(deliveryState('Sent')).toBe('sent');expect(deliveryState('Delivered')).toBe(null);
  expect(deliveryState('Failed')).toBe('failed');expect(deliveryState('Cancelled')).toBe('failed');
 });
 it('requires an authoritative part count and unique receipts for every part',()=>{
  expect(completeDeliveryProof(null,1)).toBe(false);expect(completeDeliveryProof(3,1)).toBe(false);
  expect(completeDeliveryProof(3,2)).toBe(false);expect(completeDeliveryProof(3,3)).toBe(true);
  expect(completeDeliveryProof(0,0)).toBe(false);expect(completeDeliveryProof(3,4)).toBe(false);
 });
 it('rechecks consent, verification and publication',()=>{
  expect(canReceiveSms({consent:true,verified:true},{status:'published'})).toBe(true);
  expect(canReceiveSms({consent:false,verified:true},{status:'published'})).toBe(false);
  expect(canReceiveSms({consent:true,verified:false},{status:'published'})).toBe(false);
  expect(canReceiveSms({consent:true,verified:true},{status:'draft'})).toBe(false);
  expect(canReceiveSms({consent:true,verified:true},{status:'published',archived_at:'date'})).toBe(false);
 });
 it('only pins explicitly configured device and valid SIM',()=>{
  expect(gatewaySelection(undefined,undefined)).toEqual({});
  expect(gatewaySelection('device-one','2')).toEqual({deviceId:'device-one',simNumber:2});
  expect(()=>gatewaySelection('device-one','9')).toThrow('SIM');
 });
 it('recognizes exact STOP commands without interpreting normal text',()=>{
  expect(isStopMessage(' stop ')).toBe(true);expect(isStopMessage('UNSUBSCRIBE')).toBe(true);
  expect(isStopMessage('please stop by the farm')).toBe(false);
 });
});
