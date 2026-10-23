export type RecipientState = 'queued' | 'accepted' | 'sent' | 'delivered' | 'failed' | 'unknown' | 'suppressed';
const gsm = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const extension = '^{}\\[~]|€\f';
export function smsSegments(text: string) {
 const unicode = [...text].some(c => !gsm.includes(c) && !extension.includes(c));
 const units = unicode ? text.length : [...text].reduce((n,c)=>n+(extension.includes(c)?2:1),0);
 return {encoding: unicode ? 'Unicode' : 'GSM-7', units, segments: units === 0 ? 0 : units <= (unicode?70:160) ? 1 : Math.ceil(units/(unicode?67:153))};
}
export function isManilaQuietHour(now = new Date()) {
 const hour = (now.getUTCHours()+8)%24;return hour >=20 || hour<6;
}
export function nextManilaSixAm(now = new Date()) {
 const local = new Date(now.getTime()+8*60*60_000);
 const next = Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),-2);
 return new Date(next <= now.getTime() ? next + 24*60*60_000 : next).toISOString();
}
export function canReceiveSms(contact: {consent?: boolean;verified?: boolean}|null, bulletin: {status?: string;archived_at?: unknown}) {
 return contact?.consent === true && contact?.verified === true && bulletin.status === 'published' && !bulletin.archived_at;
}
export function gatewaySelection(device?: string, sim?: string) {
 if(sim && !/^[1-3]$/.test(sim))throw new Error('Configured SMS SIM must be 1, 2 or 3');
 return {...(device?.trim()?{deviceId:device.trim()}:{}),...(sim?{simNumber:Number(sim)}:{})};
}
export function deliveryState(state: unknown): 'sent'|'failed'|null {
 const value=String(state||'').toLowerCase();
 // SMS Gate's aggregate Delivered means ANY multipart part arrived. GET does
 // not expose part states, so it cannot prove complete delivery by itself.
 return value==='sent'?'sent':['failed','cancelled'].includes(value)?'failed':null;
}
export function completeDeliveryProof(expected: unknown, received: unknown) {
 return Number.isSafeInteger(expected) && Number(expected)>0 && Number.isSafeInteger(received) && received===expected;
}
export function isStopMessage(value: unknown) { return ['STOP','UNSUBSCRIBE','CANCEL'].includes(String(value||'').trim().toUpperCase()); }
export function aggregateRecipients(rows: {status: string}[]) {
 const counts:Record<RecipientState,number>={queued:0,accepted:0,sent:0,delivered:0,failed:0,unknown:0,suppressed:0};
 for(const row of rows)if(row.status in counts)counts[row.status as RecipientState]++;
 const active=rows.length-counts.suppressed;
 const status = counts.unknown?'unknown':counts.queued?'queued':counts.accepted?'accepted':counts.sent?'sent':active===0?'suppressed':counts.delivered===active?'delivered':counts.failed===active?'failed':'mixed';
 return {counts,status,recipients:rows.length};
}
