const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?(Z|([+-])([01]\d|2[0-3]):([0-5]\d))$/;

export function parseIsoInstant(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_TIMESTAMP.exec(value);
  if (!m) return null;
  const [, ys, ms, ds, , , , , zone, , oh, om] = m;
  const y=Number(ys), month=Number(ms), day=Number(ds);
  const leap=y%4===0&&(y%100!==0||y%400===0), days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1||month>12||day<1||day>days[month-1]) return null;
  if(zone!=='Z'&&(Number(oh)>14||Number(om)>59||(Number(oh)===14&&Number(om)!==0))) return null;
  const instant=Date.parse(value);
  return Number.isFinite(instant)?instant:null;
}

export function validIanaTimeZone(value) {
  if(typeof value!=='string'||!value||/^[+-]\d/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0); return true; } catch { return false; }
}

export function isPlainData(value, stack = new WeakSet()) {
  if(value===null||typeof value==='string'||typeof value==='boolean') return true;
  if(typeof value==='number') return Number.isFinite(value);
  if(typeof value!=='object') return false;
  if(stack.has(value)) return false;
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null) return false;
  if(Reflect.ownKeys(value).some((k)=>typeof k==='symbol')) return false;
  stack.add(value);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const valid=Object.keys(value).every((k)=>Object.hasOwn(descriptors[k], 'value')&&isPlainData(descriptors[k].value,stack));
  stack.delete(value);
  return valid;
}
