// Synthetic reference-sized rows for visual tests only; never imported by the app.
const names = ['WOOD & PAPER a.s.', 'LZ - PROJEKT plus s.r.o.', 'Daria Pisareva', 'Marland s.r.o.', 'probautex s.r.o.', 'Štůšek - DVB s.r.o.', 'Petr Bartoň', 'Studio K'];
const numbers = ['1443260143','260612','260615','260620','260617','260618','260619','260621'];
const amounts = [266189,15730,12500,243687,106192,24142,9116,29900];
const due = ['2026-09-15','2026-09-16','2026-09-20','2026-10-22','2026-11-10','2026-11-10','2026-11-20','2026-11-28'];
export const invoiceRows = names.map((name,index)=>({
 id:`10000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`, organization_id:'20000000-0000-4000-8000-000000000001',
 invoice_number:numbers[index],counterparty_name:name,counterparty_ico:'12345678',counterparty_dic:'CZ12345678',counterparty_email:`faktury${index}@example.invalid`,variable_symbol:numbers[index],
 amount:amounts[index],paid_amount:index===7?amounts[index]:index===5?5000:0,currency:'CZK',amount_without_vat:amounts[index]/1.21,vat_rate:21,
 issue_date:'2026-09-01',due_date:due[index],status:index===7?'paid':index<3?'overdue':'pending',source:'manual',file_url:null,notes:null,
 paid_at:index===7?'2026-10-15T12:00:00Z':null,reminders_sent:index<3?1:0,next_reminder_at:index===7?null:'2026-10-20T08:00:00Z',last_reminder_at:null,reminders_paused:false,reminders_paused_at:null,reminders_paused_by:null,reminder_days_snapshot:[],reminder_plan_effective_from:null,
 created_at:'2026-09-01T08:00:00Z',updated_at:'2026-10-19T08:00:00Z'
}));
export const initialQuery={query:'',status:null,currency:null,from:null,to:null,dueFrom:null,dueTo:null,amountMin:null,amountMax:null,paymentState:null,bankMatch:null,page:1};
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function invoicePage(url=new URL('http://fixture/api/invoices'), scenario='normal',rows=invoiceRows){
 let all=scenario==='empty'?[]:structuredClone(rows);
 if(scenario==='stress')all=all.map(row=>({...row,invoice_number:'FV-2026-NEOBVYKLE-DLOUHE-CISLO-1234567890',counterparty_name:'Mezinárodní obchodní společnost s velmi dlouhým názvem s.r.o.',amount:999999999.99,paid_amount:row.status==='paid'?999999999.99:row.paid_amount}));
 const active_count=all.filter(row=>['pending','overdue'].includes(row.status)).length;
 const p=url.searchParams;
 all=all.filter(row=>(!p.get('status')||row.status===p.get('status')||(p.get('status')==='closed'&&['paid','cancelled'].includes(row.status)))&&(!p.get('currency')||row.currency===p.get('currency'))&&(!p.get('from')||row.issue_date>=p.get('from'))&&(!p.get('to')||row.issue_date<=p.get('to'))&&(!p.get('due_from')||row.due_date>=p.get('due_from'))&&(!p.get('due_to')||row.due_date<=p.get('due_to'))&&(!p.get('amount_min')||row.amount>=Number(p.get('amount_min')))&&(!p.get('amount_max')||row.amount<=Number(p.get('amount_max')))&&(!p.get('payment')||p.get('payment')==='unpaid'&&row.paid_amount===0||p.get('payment')==='partial'&&row.paid_amount>0&&row.paid_amount<row.amount||p.get('payment')==='paid'&&row.paid_amount===row.amount)&&(!p.get('q')||normalize(p.get('q')).split(/\s+/).every(term=>normalize([row.invoice_number,row.counterparty_name,row.counterparty_email,row.variable_symbol].join(' ')).includes(term))));
 const total=all.length,page=Number(p.get('page')||1),size=Number(p.get('page_size')||25),open_totals={};
 for(const row of all)if(['pending','overdue'].includes(row.status))open_totals[row.currency]=(open_totals[row.currency]||0)+row.amount-row.paid_amount;
 return {invoices:all.slice((page-1)*size,page*size),total,open_totals,currencies:[...new Set(rows.map(row=>row.currency))],active_count,can_manage:scenario!=='viewer',page,page_size:size,total_pages:Math.max(1,Math.ceil(total/size))};
}

export const invoicePagingRows = Array.from({length:58},(_,i)=>({...structuredClone(invoiceRows[i%8]),id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,invoice_number:String(100000+i)}));
export function invoiceTotals(url=new URL('http://fixture/api/invoices'),scenario='normal',rows=invoiceRows){
 const all=new URL(url);all.searchParams.set('page','1');all.searchParams.set('page_size','500');
 const cents={};for(const row of invoicePage(all,scenario,rows).invoices)cents[row.currency]=(cents[row.currency]||0)+Math.round(row.amount*100);
 return Object.fromEntries(Object.entries(cents).map(([currency,value])=>[currency,value/100]));
}
