import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMandate } from '../../src/domain/mandate/validateMandate.js';
import { CURRENCY_MINOR_UNITS, SUPPORTED_CURRENCIES } from '../../src/domain/mandate/currencies.js';
const mandate={mandateId:'m-1',maxAmountMinor:1_500_000,currency:'INR',allowedCategories:['electronics'],meetupRules:{requirePublicPlace:true,daytimeStart:'09:00',daytimeEnd:'18:00',timeZone:'Asia/Kolkata'},expiresAt:'2027-01-01T00:00:00Z',guardianId:'guardian-1',riskThreshold:40};
test('mandate validates required fields and rejects malformed values',()=>{assert.deepEqual(validateMandate(mandate),{valid:true,errors:[]});const bad=validateMandate({...mandate,maxAmountMinor:1.5,currency:'inr',riskThreshold:101,guardianId:''});assert.equal(bad.valid,false);assert.ok(bad.errors.some(x=>x.includes('maxAmountMinor')));});
test('supported currency allowlist defines exponents including INR, JPY, and KWD',()=>{assert.equal(CURRENCY_MINOR_UNITS.INR,2);assert.equal(CURRENCY_MINOR_UNITS.JPY,0);assert.equal(CURRENCY_MINOR_UNITS.KWD,3);assert.ok(SUPPORTED_CURRENCIES.includes('INR'));assert.equal(validateMandate({...mandate,currency:'ZZZ'}).valid,false);});
test('rejects impossible calendar dates and invalid IANA timezone identifiers',()=>{assert.equal(validateMandate({...mandate,expiresAt:'2026-02-31T12:00:00Z'}).valid,false);assert.equal(validateMandate({...mandate,meetupRules:{...mandate.meetupRules,timeZone:'Mars/Olympus'}}).valid,false);});
test('accepts valid UTC-offset expiry timestamp',()=>assert.equal(validateMandate({...mandate,expiresAt:'2026-12-31T19:00:00-05:00'}).valid,true));
