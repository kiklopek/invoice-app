export function subscriptionFixture(scenario='active') {
 const data={subscription:{status:'active',state:'active',plan:'profi',period:'monthly',current_period_end:'2026-11-23T00:00:00Z',has_card:true,managed_by_stripe:true,billing_exempt:false},can_manage:true,available:true,vat_payer:true,
 details:{pricing:{amount:159000,nextAmount:192390,currency:'czk',interval:'month',nextAt:'2026-11-23T00:00:00Z'},card:{brand:'Mastercard',last4:'1111',expMonth:12,expYear:2028,expired:false},paymentType:'card',history:[{id:'in_fixture',number:'SPL-2026-10',created:'2026-10-23T00:00:00Z',amount:192390,currency:'czk',status:'paid',url:'https://invoice.stripe.com/fixture',pdf:'https://pay.stripe.com/fixture.pdf'}],error:false},
 usage:{month:'2026-10-01T00:00:00Z',metrics:[{key:'invoices',label:'Faktury',used:24,limit:500,period:'month'},{key:'customers',label:'Zákazníci',used:18,limit:null,period:'total'},{key:'payments',label:'Platby',used:125,limit:null,period:'total'},{key:'members',label:'Uživatelé a pozvánky',used:3,limit:null,period:'total'}]}};
 if(scenario==='trial'){Object.assign(data.subscription,{state:'trial',status:'trialing',trial_ends_at:'2026-11-02T00:00:00Z',trial_invoice_limit:50,trial_invoices_used:24});Object.assign(data.usage.metrics[0],{used:24,limit:50,period:'trial'});}
 if(scenario==='yearly'){data.subscription.period='yearly';data.details.pricing={...data.details.pricing,amount:1590000,nextAmount:1923900,interval:'year'};}
 if(scenario==='custom'){Object.assign(data.details.pricing,{amount:139000,nextAmount:99000});}
 if(scenario==='canceled')Object.assign(data.subscription,{cancel_at_period_end:true});
 if(scenario==='scheduled')Object.assign(data.subscription,{scheduled_plan:'start',scheduled_period:'monthly',scheduled_at:'2026-11-23T00:00:00Z'});
 if(scenario==='past_due'){data.subscription.state='past_due';data.subscription.status='past_due';}
 if(scenario==='exempt'){data.subscription.billing_exempt=true;data.subscription.has_card=false;data.details=null;data.usage.metrics[0].limit=null;}
 if(scenario==='missing'){Object.assign(data.subscription,{plan:null,period:null,state:'needs_payment',status:'missing',has_card:false,managed_by_stripe:false});data.details={pricing:null,card:null,paymentType:null,history:[],error:false};}
 if(scenario==='expired'){data.subscription.state='expired';data.subscription.status='canceled';}
 if(scenario==='readonly'){data.can_manage=false;data.details=null;}
 if(scenario==='provider_error')data.details.error=true;
 if(scenario==='expired_card')data.details.card={...data.details.card,expMonth:1,expYear:2025,expired:true};
 if(scenario==='limit')data.usage.metrics[0].used=500;
 return data;
}
