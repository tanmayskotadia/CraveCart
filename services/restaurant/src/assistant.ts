import express,{type Express} from 'express';
import {z} from 'zod';
import {assistantProposalInputSchema,assistantCartCommandSchema,cartInputSchema,findCity,type CartLineInput,type Principal,type MenuItemInput} from '@cravecart/contracts';
import {internalOnly,internalCall,HttpError,json,type DomainContext} from '@cravecart/platform';
import {executeOnce} from '@cravecart/persistence';
import type {installCatalog} from './catalog.js';
import type {OrderRecord} from './orders.js';
export function installAssistantTools(app:Express,ctx:DomainContext,catalog:ReturnType<typeof installCatalog>){
 const {db,client,config}=ctx,router=express.Router();
 router.use(internalOnly(ctx,['utils']));
 async function actor(sessionId:string){return internalCall<Principal>(ctx,'auth','/internal/v1/sessions/inspect',{sessionId});}
 router.post('/read',async(req,res)=>{
  const input=z.object({sessionId:z.string().uuid(),tool:z.enum(['menu','orders','order','refund']),city:z.string().max(60).optional(),query:z.string().max(100).optional(),orderId:z.string().uuid().optional()}).strict().parse(req.body),principal=await actor(input.sessionId);
  if(input.tool==='menu'){
   const city=findCity(input.city);if(!city)throw new HttpError(422,'CITY_REQUIRED','Choose a supported city before searching menus');
   const stores=await db.collection('restaurants').find({city:city.slug,published:true,paused:false,...(config.NODE_ENV==='production'?{sample:{$ne:true}}:{})}).limit(100).toArray();
   const members=stores.length?await internalCall<{activeUserIds:string[]}>(ctx,'auth','/internal/v1/memberships/check',{role:'seller',userIds:[...new Set(stores.map(s=>String(s.userId)))]}):{activeUserIds:[]};
   const active=stores.filter(s=>members.activeUserIds.includes(String(s.userId))),words=(input.query??'').toLowerCase().split(/\s+/).filter(w=>w.length>1&&!city.name.toLowerCase().includes(w));
   const rows=await db.collection<MenuItemInput&{_id:string;restaurantId:string;deleted:boolean}>('menu_items').find({restaurantId:{$in:active.map(s=>String(s._id))},deleted:false,available:true,stock:{$ne:0}}).limit(250).toArray();
   const cards=rows.filter(r=>!words.length||words.some(w=>(r.name+' '+(active.find(s=>String(s._id)===r.restaurantId)?.cuisines??[]).join(' ')).toLowerCase().includes(w))).slice(0,8).map(r=>{
    const store=active.find(s=>String(s._id)===r.restaurantId)!;
    return {restaurantId:r.restaurantId,itemId:r._id,restaurantName:String(store.name),name:r.name,priceMinor:r.priceMinor,href:'/restaurants/'+store.slug,customizationRequired:r.variants.length>0||r.modifierGroups.some(g=>g.min>0)};
   });
   json(res,{city:city.slug,cards,checkedAt:new Date().toISOString(),scope:'Up to eight currently listed dishes from a bounded published-catalog search. Availability and exact prices are rechecked at cart/checkout.'});return;
  }
  const orders=db.collection<OrderRecord>('orders');
  const scope={userId:principal.userId,'quote.mode':config.COMMERCE_MODE};
  const present=(o:OrderRecord)=>({id:o.id,number:o.number,status:o.status,paymentState:o.paymentState,version:o.version,refundRequestedMinor:o.refundRequestedMinor,refundedMinor:o.refundedMinor,mode:o.quote.mode,checkedAt:new Date().toISOString()});
  if(input.tool==='orders'||!input.orderId){json(res,(await orders.find(scope).sort({createdAt:-1,_id:-1}).limit(5).toArray()).map(present));return;}
  const order=await orders.findOne({_id:input.orderId,...scope});
  if(!order)throw new HttpError(404,'ORDER_NOT_FOUND','Only your own orders can be read');
  json(res,present(order));
 });
 router.post('/cart-preview',async(req,res)=>{
  const {sessionId,...input}=z.object({sessionId:z.string().uuid(),...assistantProposalInputSchema.shape}).strict().parse(req.body),principal=await actor(sessionId);
  const address=await internalCall<{id:string;label:string;city:string}|null>(ctx,'auth','/internal/v1/assistant-identity/default-address',{sessionId});
  if(!address)throw new HttpError(422,'ADDRESS_REQUIRED','Save a default delivery address before proposing a cart change');
  const item=await db.collection<MenuItemInput&{_id:string;restaurantId:string}>('menu_items').findOne({_id:input.itemId,restaurantId:input.restaurantId,deleted:false});
  if(!item||item.variants.length||item.modifierGroups.some(g=>g.min>0))throw new HttpError(422,'CUSTOMIZATION_REQUIRED','Configure this dish and its required choices on the restaurant page');
  const old=await db.collection('carts').findOne({_id:principal.userId as never});
  if(old?.lines?.length&&old.restaurantId!==input.restaurantId)throw new HttpError(409,'REPLACE_CART_REQUIRED','Your cart contains another restaurant. Review it before replacing anything');
  const lines:CartLineInput[]=(old?.lines??[]).map((l:CartLineInput)=>({itemId:l.itemId,variantId:l.variantId,optionIds:l.optionIds,quantity:l.quantity,instructions:l.instructions}));
  const existing=lines.find(l=>l.itemId===input.itemId&&!l.variantId&&!l.optionIds.length&&!l.instructions);
  if(existing)existing.quantity+=input.quantity;else lines.push({itemId:input.itemId,variantId:null,optionIds:[],quantity:input.quantity,instructions:''});
  const proposed=cartInputSchema.parse({expectedVersion:old?.version??0,restaurantId:input.restaurantId,addressId:address.id,replace:false,lines});
  const priced=await catalog.validateCart(proposed.restaurantId,proposed.addressId,principal.userId,proposed.lines);
  json(res,{input:proposed,expectedSubtotalMinor:priced.subtotalMinor,summary:`Add ${input.quantity} × ${item.name} from ${priced.record.name} to your existing cart. Items subtotal after this change: ₹${(priced.subtotalMinor/100).toFixed(2)}. Delivery address: ${address.label}. Delivery fees, tax and offers are reviewed at checkout.`});
 });
 router.post('/cart-apply',async(req,res)=>{
  const input=assistantCartCommandSchema.parse(req.body),principal=await actor(input.sessionId);
  if(config.ASSISTANT_WRITES_ENABLED!=='true'||config.ASSISTANT_WRITES_REVIEWED!=='true')throw new HttpError(503,'ASSISTANT_WRITES_DISABLED','Assistant cart actions are not enabled');
  const result=await executeOnce(client,db,principal.userId+':assistant-cart',input.commandId,{input:input.input,expectedSubtotalMinor:input.expectedSubtotalMinor,expiresAt:input.expiresAt},async(session)=>{
   if(Date.parse(input.expiresAt)<=Date.now())throw new HttpError(409,'ACTION_EXPIRED','Review a new cart proposal');
   const value=await catalog.saveCart(cartInputSchema.parse(input.input),principal.userId,session,input.expectedSubtotalMinor);
   return {applied:true,href:'/cart',version:value.version};
  });json(res,result);
 });
 app.use('/internal/v1/assistant-tools',router);
}

