import { mapSchema } from '../src/notion';
import { VENDORS } from '../src/vendors';
import type { Configuration, RequestDraft, DraftRecord } from '../src/types';
export const databaseId='11111111-2222-4333-8444-555555555555';
export const dataSourceId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
export function source() {
  const fields: Record<string,string>={'Item Description':'title',Status:'status',Vendor:'select',Team:'select','Orderer/Recipient':'people',SKU:'rich_text','Product URL':'url',Qty:'number','Unit Price':'number',Extension:'formula'};
  const properties: Record<string,any>={};
  Object.entries(fields).forEach(([name,type],i)=>properties[name]={id:`prop-${i}`,name,type,[type]:{}});
  properties.Status.status.options=[{id:'normal',name:'NORMAL Request'},{id:'incomplete',name:'Incomplete Request'}];
  properties.Vendor.select.options=VENDORS.map((v,i)=>({id:`vendor-${i}`,name:v.label})).concat([{id:'other',name:'Other'}]);
  properties.Team.select.options=[{id:'team1',name:'Robotics'}];
  return {id:dataSourceId,properties};
}
export function configuration(): Configuration {return {databaseUrl:`https://www.notion.so/${databaseId}`,schema:mapSchema(source(),databaseId),people:[{id:'person1',name:'Student'}],defaultTeam:'team1',defaultRecipient:'person1'};}
export function draft():RequestDraft{return {description:'NEO 550 Brushless Motor',status:'NORMAL Request',url:'https://www.revrobotics.com/rev-21-1651/',sku:'',team:'team1',recipient:'person1',quantity:2,price:30,currencyConfirmed:true};}
export function record():DraftRecord{return {key:'42:https://www.revrobotics.com/rev-21-1651/',submissionId:'12345678-1234-1234-1234-123456789012',updatedAt:1,draft:draft(),capture:{kind:'product',vendor:'REV',url:draft().url,description:draft().description,price:30,sku:'',currency:'USD',variants:[],issues:[]}};}
export const response=(value:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(value),{status,headers});
