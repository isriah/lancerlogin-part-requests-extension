import type { DeviceOptions, RequestDraft, DraftRecord } from '../src/types';
export const SITE='https://team-site.example.test';
export const API=`${SITE}/api/public/part-requests`;
export const DEVICE_KEY='fixtureDeviceKey0000000000000000000000000000'.slice(0,43);
export const SUBMISSION_ID='12345678-1234-1234-1234-123456789012';
export function deviceOptions(): DeviceOptions {return {memberName:'Test Student A',teams:[{id:'team1',name:'Robotics'}],recipients:[{id:'person1',name:'Test Student A'}],defaultRecipientId:'person1',recipientsUpdatedMs:1};}
export function draft():RequestDraft{return {description:'NEO 550 Brushless Motor',status:'NORMAL Request',url:'https://www.revrobotics.com/rev-21-1651/',sku:'',team:'team1',recipient:'person1',quantity:2,price:30,currencyConfirmed:true};}
export function record():DraftRecord{return {key:'42:https://www.revrobotics.com/rev-21-1651/',submissionId:SUBMISSION_ID,updatedAt:1,draft:draft(),capture:{kind:'product',vendor:'REV',url:draft().url,description:draft().description,price:30,sku:'',currency:'USD',variants:[],issues:[]}};}
export const response=(value:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(value),{status,headers});
