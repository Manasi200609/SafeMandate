export const mandateFixture = {
  mandateId: 'mandate-demo-01', maxAmountMinor: 1_500_000, currency: 'INR', allowedCategories: ['Electronics', 'Home & living', 'Outdoor'],
  meetupRules: { requirePublicPlace: true, daytimeStart: '09:00', daytimeEnd: '18:00', timeZone: 'Asia/Kolkata' },
  expiresAt: '2026-12-31T18:29:59Z', guardianId: 'guardian-demo', riskThreshold: 40
};

export const transactionFixtures = [
  { id:'SM-2048', proposalId:'proposal-demo-2048', item:'Sony WH-1000XM5', category:'Electronics', amountMinor:2899000, currency:'INR', seller:'Aarav Electronics', sellerId:'seller-aarav', meetup:'Third Wave Coffee, Indiranagar', meetupTime:'11:30', date:'2026-11-09', state:'NEEDS_GUARDIAN', risk:42, reason:'Amount exceeds the mandate limit; guardian review required.', buyer:'Mansi Rao', evidence:['₹28,990 is above the ₹15,000 mandate limit.','Seller profile has limited verified history.'], image:'headphones', policyCodes:['OVER_BUDGET','RISK_ABOVE_THRESHOLD'] },
  { id:'SM-2041', item:'Kindle Paperwhite', category:'Electronics', amountMinor:1399000, currency:'INR', seller:'Read More Store', meetup:'Third Wave Coffee, Koramangala', meetupTime:'15:00', date:'2026-11-08', state:'READY_FOR_PAYMENT', risk:18, reason:'Proposal satisfies the active mandate.', policyCodes:[] },
  { id:'SM-2035', item:'Camping lantern set', category:'Outdoor', amountMinor:429900, currency:'INR', seller:'Trail & Camp', meetup:'Cubbon Park Gate 3', meetupTime:'10:00', date:'2026-11-06', state:'BLOCKED', risk:71, reason:'Seller risk and category conditions were not accepted.', policyCodes:['RISK_ABOVE_THRESHOLD'] },
  { id:'SM-2029', item:'Ceramic pour-over set', category:'Home & living', amountMinor:289000, currency:'INR', seller:'Clay Studio', meetup:'Blue Tokai, HSR Layout', meetupTime:'12:15', date:'2026-11-03', state:'GUARDIAN_APPROVED', risk:34, reason:'Guardian-approved exception; provider action is not connected.', policyCodes:['OVER_BUDGET'] },
  { id:'SM-2018', item:'Portable SSD 1TB', category:'Electronics', amountMinor:949900, currency:'INR', seller:'Byte Market', meetup:'Cafe Azzure, Jayanagar', meetupTime:'16:00', date:'2026-10-30', state:'EXPIRED', risk:22, reason:'Mandate expired before authorization.', policyCodes:[] },
  { id:'SM-2012', item:'Desk lamp', category:'Home & living', amountMinor:689900, currency:'INR', seller:'Northstar Home', meetup:'Church Street Social', meetupTime:'14:30', date:'2026-10-28', state:'READY_FOR_PAYMENT', risk:17, reason:'Policy permits a next step; no provider order or authorization exists.', policyCodes:[] }
];

export const demoActivity = [
  { id:'a-1', type:'PROPOSED', title:'Proposal prepared', detail:'Sony WH-1000XM5 · ₹28,990', item:'Sony WH-1000XM5', amountMinor:2_899_000, currency:'INR', actor:'Agent preview', createdAt:'2026-11-09T10:42:00+05:30', tone:'lime', verified:false },
  { id:'a-2', type:'NEEDS_GUARDIAN', title:'Policy review completed', detail:'Over mandate limit · Risk score meets review threshold', actor:'Deterministic policy preview', createdAt:'2026-11-09T10:42:30+05:30', tone:'amber', verified:false },
  { id:'a-3', type:'GUARDIAN_DECISION', title:'Guardian review is pending', detail:'No approval has been recorded.', actor:'Awaiting guardian', createdAt:'2026-11-09T10:43:00+05:30', tone:'blue', verified:false }
];

export const agentSteps = ['Understand request','Find listings','Compare sellers','Evaluate risks','Check mandate','Prepare proposal'];
export const demoAgentMetrics={listingsReviewed:24,period:'this week'};
export const sellerComparisons=[{seller:'Aarav Electronics',priceMinor:2899000,signal:'New profile'},{seller:'Orbit Audio House',priceMinor:3049000,signal:'Limited history'},{seller:'Soundline Market',priceMinor:3199000,signal:'Sample listing'}];
export const sampleRecommendation = { item:'Sony WH-1000XM5', priceMinor:2899000, seller:'Aarav Electronics', sellerRating:'New seller', meetup:'Third Wave Coffee · Indiranagar', time:'11:30 AM · Asia/Kolkata', riskSignals:['Price exceeds mandate by ₹13,990','Seller history is limited'], policy:'NEEDS_GUARDIAN' };


