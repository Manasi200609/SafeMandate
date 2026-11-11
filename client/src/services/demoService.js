import { mandateFixture, transactionFixtures, demoActivity, sampleRecommendation, demoAgentMetrics, sellerComparisons } from '../data/demoFixtures.js';
import { CURRENCY_MINOR_UNITS } from '../data/currencyMeta.js';
import { currentLocale } from './format.js';

const MANDATE_KEY='safe-mandate-demo-mandate';
const demoDecisions=new Map();
const read=(key,fallback)=>{try{const value=localStorage.getItem(key);return value?JSON.parse(value):fallback;}catch{return fallback;}};
// Local demo adapter only; replace with an authenticated API adapter when services exist.
export const demoService={
 sourceLabel:'Illustrative demo data · no backend or PayPal connected',
 getMandate(){return read(MANDATE_KEY,mandateFixture);},
 getTransactions(){return transactionFixtures.map(row=>({...row}));},
 getActivity(){return demoActivity.map(row=>({...row}));},
 getRecommendation(){return {...sampleRecommendation};},
 getAgentMetrics(){return {...demoAgentMetrics};},
 getSellerComparisons(){return sellerComparisons.map(row=>({...row}));},
 saveMandate(next){localStorage.setItem(MANDATE_KEY,JSON.stringify(next));return {...next};},
 recordGuardianDecision(token,decision){demoDecisions.set(token,decision);return {mode:'demo',decision};},
 getGuardianDecision(token){return demoDecisions.get(token)??null;}
};
const amount=(tx)=>tx.amountMinor/10**(CURRENCY_MINOR_UNITS[tx.currency]??2);
export function deriveAnalytics(transactions,mandate,rangeDays=30){
 const now=new Date('2026-11-09T12:00:00Z'), cutoff=new Date(now.getTime()-rangeDays*86400000);
 const selected=transactions.filter(tx=>{const d=new Date(`${tx.date}T12:00:00Z`);return d>=cutoff&&d<=now;});
 const dates=new Map(),categories=new Map();
 for(const tx of selected){dates.set(tx.date,(dates.get(tx.date)??0)+1);if(tx.state==='CAPTURED')categories.set(tx.category,(categories.get(tx.category)??0)+amount(tx));}
 const weekly=Array.from({length:7},(_,i)=>{const date=new Date(now.getTime()-(6-i)*86400000),key=date.toISOString().slice(0,10);return {day:new Intl.DateTimeFormat(currentLocale(),{weekday:'short',timeZone:'UTC'}).format(date),proposals:dates.get(key)??0};});
 const isApproved=s=>['GUARDIAN_APPROVED','READY_FOR_PAYMENT','PAYMENT_PENDING','AUTHORIZED','MEETUP_ACTIVE','CAPTURE_PENDING','CAPTURED'].includes(s);
 const isClosed=s=>['BLOCKED','EXPIRED','VOIDED'].includes(s);
 const outcomes=[{name:'outcome.proposed',value:selected.filter(t=>t.state==='PROPOSED').length},{name:'outcome.needsReview',value:selected.filter(t=>t.state==='NEEDS_GUARDIAN').length},{name:'outcome.approved',value:selected.filter(t=>isApproved(t.state)).length},{name:'outcome.closed',value:selected.filter(t=>isClosed(t.state)).length}];
 const sorted=[...selected].sort((a,b)=>a.date.localeCompare(b.date));let cumulative=0;
 const utilization=sorted.map(tx=>{if(tx.state==='CAPTURED')cumulative+=amount(tx);return {period:tx.date.slice(5),value:Math.round((cumulative/(mandate.maxAmountMinor/10**(CURRENCY_MINOR_UNITS[mandate.currency]??2)))*100)};});
 const captured=selected.filter(t=>t.state==='CAPTURED').length;
 return {weekly,categories:[...categories].map(([name,value])=>({name,value:Math.round(value)})),outcomes,utilization,captured,counts:{total:selected.length,approved:selected.filter(t=>isApproved(t.state)).length,guardian:selected.filter(t=>t.state==='NEEDS_GUARDIAN').length,blocked:selected.filter(t=>isClosed(t.state)).length}};
}



