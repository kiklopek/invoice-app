// Synthetic fixtures only, never imported by the application or uploaded live.
export const matchingInvoices = [
  ["2600201", "ACME s.r.o.", 23887, "2025-09-12"],
  ["2600723", "Dominik Heiniš", 3750, "2025-10-01"],
  ["2600610", "C.S.CARGO a.s.", 15660, "2025-09-15"],
  ["2600629", "PST CLC Mitsui-Soko a.s.", 12400, "2025-09-16"],
  ["2600194", "Marland s.r.o.", 75955, "2025-09-22"],
].map(([number,name,amount,due],index)=>({id:`10000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,invoice_number:number,variable_symbol:number,counterparty_name:name,counterparty_ico:'12345678',amount,paid_amount:0,currency:'CZK',due_date:due}));
export function matchingFixture(scenario='normal') {
 const invoices=structuredClone(matchingInvoices);
 const entries=invoices.map((invoice,index)=>({id:`30000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,line_number:index+1,fingerprint:`payment-${index+1}`,disposition:'accepted',reason:null,amount:invoice.amount,currency:'CZK',booked_on:['2025-10-07','2025-10-06','2025-10-05','2025-10-03','2025-09-28'][index],variable_symbol:index===3?null:invoice.variable_symbol,counterparty_name:index===3?'Neznámý plátce':invoice.counterparty_name,counterparty_account:'19-2000145399/0800',counterparty_account_verified:true,proposal_kind:index===3?'manual':'exact',proposal_confidence:index===1||index===3?'review':'safe',proposal_reason:index===3?null:index===1?'Odpovídá částka, ověřte variabilní symbol.':'Odpovídá variabilní symbol a částka.',proposed_invoice_ids:index===3?[]:[invoice.id],bank_payment_id:null}));
 const allocations=entries.filter((_,index)=>index!==3).map(entry=>({statement_entry_id:entry.id,invoice_id:entry.proposed_invoice_ids[0],amount:entry.amount,is_manual_partial:false,is_committed:false}));
 if(scenario==='special')entries.push(
 {...structuredClone(entries[0]),id:'ignored',fingerprint:'ignored',line_number:6,disposition:'ignored',reason:'Odchozí platba',amount:-99,counterparty_name:'Bankovní poplatek',proposed_invoice_ids:[]},
 {...structuredClone(entries[0]),id:'duplicate',fingerprint:'duplicate',line_number:7,disposition:'duplicate',reason:'Duplicita',proposed_invoice_ids:[]},
 {...structuredClone(entries[0]),id:'booked',fingerprint:'booked',line_number:8,bank_payment_id:'booked-payment'},
 {...structuredClone(entries[0]),id:'error',fingerprint:'error',line_number:9,disposition:'error',processing_error:'possible_duplicate',proposed_invoice_ids:[]},
 );
 const preview={import:{id:'40000000-0000-4000-8000-000000000001',revision:1,duplicate:scenario==='duplicate',status:'review'},account_mismatch:scenario==='bank',statement_account:'19-2000145399/0800',expected_account:scenario==='bank'?'123456789/0100':'19-2000145399/0800',statement_bank:{code:'0800',name:'Česká spořitelna',verified:true},totals:{accepted:5,ignored:scenario==='special'?1:0,errors:scenario==='special'?1:0},entries,proposal_invoices:invoices,total_entries:entries.length,request_id:'fixture'};
 return {invoices,preview,detail:{...preview,allocations,total:entries.length,progress:{booked:scenario==='special'?1:0,errors:0,remaining:5},match_reasons:{'booked-payment':'Odpovídá variabilní symbol a částka.'},own_transfers:{}}};
}
