import { describe,it,expect,vi } from 'vitest';
import { SubmissionManager, type SubmissionStore } from '../src/submissions';
import { AppError } from '../src/errors';
import type { Submission } from '../src/types';
function store(){const values=new Map<string,Submission>();return {values,get:vi.fn(async(id:string)=>values.get(id)),set:vi.fn(async(s:Submission)=>{values.set(s.id,structuredClone(s));}),remove:vi.fn(async(id:string)=>{values.delete(id);})};}
const created={pageUrl:'https://www.notion.so/new'};
describe('durable submission state',()=>{
  it('issues one create for rapid repeat clicks and returns its receipt',async()=>{
    const s=store(),m=new SubmissionManager(s),create=vi.fn(async()=>{expect(s.values.get('id')?.state).toBe('pending');return created;});
    const results=await Promise.all(Array.from({length:12},()=>m.submit('id','tab:url',create)));
    expect(create).toHaveBeenCalledTimes(1);expect(results.every(r=>r.state==='success')).toBe(true);
  });
  it('does not replay a pending POST after worker restart or popup close',async()=>{
    const s=store();await s.set({id:'id',draftKey:'tab:url',state:'pending',updatedAt:1});const create=vi.fn();
    expect((await new SubmissionManager(s).submit('id','tab:url',create)).state).toBe('uncertain');expect(create).not.toHaveBeenCalled();
  });
  it('persists uncertain timeout and known validation failure separately',async()=>{
    for(const uncertain of [true,false]){const s=store(),m=new SubmissionManager(s),create=vi.fn().mockRejectedValue(new AppError('message','test',uncertain));
      expect((await m.submit('id','key',create)).state).toBe(uncertain?'uncertain':'failed');await new SubmissionManager(s).submit('id','key',create);expect(create).toHaveBeenCalledTimes(1);}
  });
  it('marks whether the server stated the result, which decides if the ID is used up',async()=>{
    const stated=await new SubmissionManager(store()).submit('id','key',vi.fn().mockRejectedValue(new AppError('m','uncertain',true)));expect(stated).toMatchObject({state:'uncertain',recorded:true});
    const unknown=await new SubmissionManager(store()).submit('id','key',vi.fn().mockRejectedValue(new AppError('m','network',true)));expect(unknown).toMatchObject({state:'uncertain',recorded:false});
    const crash=await new SubmissionManager(store()).submit('id','key',vi.fn().mockRejectedValue(new Error('x')));expect(crash).toMatchObject({state:'uncertain',recorded:false});
    const refused=await new SubmissionManager(store()).submit('id','key',vi.fn().mockRejectedValue(new AppError('m','notion_400')));expect(refused).toMatchObject({state:'failed',recorded:true});
  });
  it('leaves no record when the server recorded nothing, so the draft stays open with the same ID',async()=>{
    const s=store(),m=new SubmissionManager(s);
    await expect(m.submit('id','key',vi.fn().mockRejectedValue(new AppError('Pair again.','pair_again',false,true)))).rejects.toMatchObject({code:'pair_again'});
    expect(s.values.has('id')).toBe(false);
    expect((await m.submit('id','key',vi.fn().mockResolvedValue(created))).state).toBe('success');
  });
  it('keeps the repeats a create reports',async()=>{
    const repeats=[{memberName:'Test Student B',createdMs:1,pageUrl:null,state:'created'}];
    expect((await new SubmissionManager(store()).submit('id','key',async()=>({...created,repeats}))).repeats).toEqual(repeats);
  });
  it('never posts if the pending record cannot be persisted',async()=>{
    const s:SubmissionStore={get:async()=>undefined,set:async()=>{throw Error('disk');},remove:async()=>{}},create=vi.fn();
    await expect(new SubmissionManager(s).submit('id','key',create)).rejects.toThrow();expect(create).not.toHaveBeenCalled();
  });
  it('retains the pending guard if receipt storage fails after creation',async()=>{
    const s=store(),set=s.set;s.set=vi.fn(async r=>{if(r.state==='success')throw Error('disk');await set(r);});const create=vi.fn().mockResolvedValue(created);
    await expect(new SubmissionManager(s).submit('id','key',create)).rejects.toThrow();
    await new SubmissionManager(s).submit('id','key',create);expect(create).toHaveBeenCalledTimes(1);
  });
});
