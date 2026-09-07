/** Member-authorized, bounded operation-set documents. Shared snapshots keep
 * their own revisions; drawing operations never overwrite the room snapshot.
 */
import {DrawingDocument,DrawingReplica} from '../src/drawing-crdt.js';
const problem=(status,message)=>Object.assign(new Error(message),{status});
const memberRoom=(state,id,user)=>{
  const room=state.pro.rooms.find(r=>r.id===id&&r.members.includes(user.id));
  if(!room)throw problem(404,'Drawing room is unavailable');return room;
};
function initial(room,symbol){
  const existing=room.drawingDocuments?.[symbol];if(existing)return existing;
  const seed=new DrawingReplica('seed');
  seed.applySnapshot([],room.payload?.workspace?.drawings?.[symbol]||[]);
  return seed.document.snapshot();
}
export async function drawingRoomRequest({store,route,method,url,user,read,result}){
  const id=route.split('/')[1],symbol=url.searchParams.get('symbol');
  if(typeof symbol!=='string'||!/^[A-Z0-9][A-Z0-9.:-]{0,39}$/.test(symbol))throw problem(400,'A valid drawing symbol is required');
  const room=memberRoom(store.state,id,user);
  if(method==='GET')return result({roomId:id,symbol,document:initial(room,symbol)});
  if(method!=='POST')throw problem(405,'Use GET or POST for drawing operations');
  const body=await read();
  if(!Array.isArray(body.operations)||body.operations.length>256)throw problem(400,'At most 256 drawing operations per request');
  // An account may have several devices, but cannot author another account's
  // registers or undo its work, even by supplying a forged request userId.
  if(body.operations.some(op=>typeof op?.actor!=='string'||!op.actor.startsWith(user.id+'.')))throw problem(403,'Drawing operations must be authored by the signed-in account');
  const saved=await store.transaction(state=>{
    const current=memberRoom(state,id,user);
    current.drawingDocuments??={};
    if(!Object.hasOwn(current.drawingDocuments,symbol)&&Object.keys(current.drawingDocuments).length>=16)throw problem(400,'Room drawing-symbol capacity reached');
    try{
      const document=new DrawingDocument(initial(current,symbol));
      const added=document.merge(body.operations);
      current.drawingDocuments[symbol]=document.snapshot();
      if(Buffer.byteLength(JSON.stringify(current.drawingDocuments))>16_000_000)throw problem(400,'Room drawing-history byte capacity reached');
      return {roomId:id,symbol,added,document:current.drawingDocuments[symbol]};
    }catch(error){if(error.status)throw error;throw problem(400,error.message);}
  });
  return result(saved);
}
