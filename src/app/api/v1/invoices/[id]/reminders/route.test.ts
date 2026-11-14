import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ unauthorized: false, error: null as { message: string; code: string } | null, calls: [] as { name: string; args: unknown }[], scope: "" }));
vi.mock("@/lib/auth-api-key", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/auth-api-key")>();
  return { ...actual, recordApiKeyRequest: async () => {}, getApiKeyIdentity: async (_request: Request, scope: string) => {
    state.scope=scope;
    if(state.unauthorized) throw new actual.ApiKeyError("Unauthorized",401,"invalid_api_key");
    return { organizationId:"our-org",actingUserId:"our-admin",scopes:["reminders:write"],service:{rpc:async(name:string,args:unknown)=>{state.calls.push({name,args});return {data:{invoice_id:"550e8400-e29b-41d4-a716-446655440000",paused:true,next_reminder_at:null},error:state.error};}} };
  } };
});
import { PATCH } from "./route";
const id="550e8400-e29b-41d4-a716-446655440000";
const context={params:Promise.resolve({id})};
const request=(body:unknown)=>new Request(`https://www.splatno.com/api/v1/invoices/${id}/reminders`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{state.unauthorized=false;state.error=null;state.calls=[];state.scope="";});
describe("public reminder controls",()=>{
  it("requires key authentication and a dedicated scope",async()=>{
    state.unauthorized=true;
    expect((await PATCH(request({paused:true}),context)).status).toBe(401);
    expect(state.scope).toBe("reminders:write");
    expect(state.calls).toHaveLength(0);
  });
  it("passes only company, actor, invoice and pause state to the atomic operation",async()=>{
    const response=await PATCH(request({paused:true}),context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({reminders:{paused:true,next_reminder_at:null}});
    expect(state.calls).toEqual([{name:"set_api_invoice_reminders",args:{target_org:"our-org",actor_user:"our-admin",target_invoice:id,paused:true}}]);
  });
  it.each([{}, {paused:"true"}, {paused:false,paid_amount:100}, {paused:null}])("rejects an unsupported patch %j",async body=>{
    expect((await PATCH(request(body),context)).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
  it("returns 404 for an unavailable company-scoped invoice and409 for in-flight delivery",async()=>{
    state.error={message:"invoice_not_found",code:"P0002"};
    expect((await PATCH(request({paused:true}),context)).status).toBe(404);
    state.error={message:"reminder_in_flight",code:"55000"};
    const response=await PATCH(request({paused:true}),context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:"reminder_in_flight"});
  });
});
