import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { otpRequestSchema, otpVerifySchema, otpChallengeResponseSchema, loginResultSchema, sessionResponseSchema, principalSchema, roleSchema, mfaEnrollSchema, mfaVerifySchema, applicationSchema, applicationSaveSchema, applicationUpdateSchema, applicationSubmitSchema, decisionSchema, contactSchema, errorSchema } from '@cravecart/contracts';

const paths: Record<string, Record<string, unknown>> = {};
const empty = z.object({}).strict();
const schema = (value:z.ZodType, input=false)=>z.toJSONSchema(value,{target:'draft-2020-12',io:input?'input':'output',unrepresentable:'any'});
function add(owner:string,method:string,path:string,response:z.ZodType,body?:z.ZodType,options:{public?:boolean;status?:number;idempotent?:boolean;policy?:string}={}) {
  const mutation=method!=='get';
  const parameters:Array<Record<string,unknown>>=[...path.matchAll(/\{([^}]+)\}/g)].map(match=>({in:'path',name:match[1],required:true,schema:{type:'string',...(match[1]==='challengeId'?{minLength:32}:{format:'uuid'})}}));
  if(mutation)parameters.push({in:'header',name:'Origin',required:true,schema:{type:'string'},description:'Must match the configured app origin.'});
  if(mutation&&!options.public)parameters.push({in:'header',name:'X-CSRF-Token',required:true,schema:{type:'string',minLength:32},description:'Session-bound token from /auth/me or /auth/csrf.'});
  if(options.idempotent)parameters.push({in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',minLength:16,maxLength:128}});
  const envelope=z.object({data:response,meta:z.object({requestId:z.string().uuid()})});
  paths[path]??={};
  paths[path]![method]={operationId:`identity_${method}_${path.replace(/[^a-zA-Z0-9]/g,'_')}`,tags:[owner],summary:`${method.toUpperCase()} ${path}`,'x-owner':owner,'x-contract-status':'implementation-ready','x-client-generation-ready':true,'x-authorization':options.policy??(options.public?'Public challenge flow; origin required for mutations. MFA session-bound challenges additionally require matching cookies and CSRF.':'Authenticated owner only; all mutations require origin and session-bound CSRF.'),security:options.public?[]:[{sessionCookie:[]}],parameters,...(body?{requestBody:{required:true,content:{'application/json':{schema:schema(body,true)}}}}:{}),responses:{[options.status??200]:{description:'Successful response; 202 records acceptance, inspect operation state for completion.',content:{'application/json':{schema:schema(envelope)}}},default:{description:'Structured error including validation, auth, CSRF, conflict, rate limits and dependency unavailability.',content:{'application/json':{schema:schema(errorSchema)}}}}};
}
add('auth','get','/auth/capabilities',z.object({methods:z.array(z.enum(['phone','email'])),developmentDelivery:z.boolean()}),undefined,{public:true});
for(const path of ['/auth/login','/auth/register','/auth/otp/request'])add('auth','post',path,otpChallengeResponseSchema,otpRequestSchema,{public:true,status:202,policy:'Contact proof only. Registration needs name and creates customer membership only. Public admin registration denied. Contact normalization, cooldown, expiry and attempt limits enforced.'});
add('auth','post','/auth/otp/verify',loginResultSchema,otpVerifySchema,{public:true});
add('auth','get','/auth/me',sessionResponseSchema);
add('auth','patch','/auth/me',principalSchema,z.object({name:z.string().trim().min(2).max(80)}).strict());
add('auth','get','/auth/csrf',z.object({csrfToken:z.string()}));
add('auth','post','/auth/refresh',sessionResponseSchema,empty, {policy:'Refresh cookie plus session-bound CSRF and origin. Rotation is atomic; reuse revokes the session family.'});
add('auth','post','/auth/logout',z.object({loggedOut:z.literal(true)}),empty);
add('auth','get','/auth/sessions',z.array(z.object({id:z.string().uuid(),current:z.boolean(),workspace:roleSchema,createdAt:z.string().datetime(),expiresAt:z.string().datetime()})));
add('auth','delete','/auth/sessions/{sessionId}',z.object({revoked:z.literal(true)}));
add('auth','post','/auth/sessions/revoke-all',z.object({revoked:z.literal(true)}),empty,{policy:'Owner plus recent primary authentication or fresh MFA; origin and CSRF required.'});
add('auth','post','/auth/workspace',z.object({workspace:roleSchema}),z.object({workspace:roleSchema}).strict(),{policy:'Granted roles only; admin additionally requires fresh MFA; origin and CSRF required.'});
add('auth','post','/auth/mfa/challenge',z.object({mfaChallengeId:z.string(),enrollmentRequired:z.boolean()}),empty);
add('auth','post','/auth/mfa/enroll',z.object({secret:z.string(),uri:z.string()}),mfaEnrollSchema,{public:true});
add('auth','post','/auth/mfa/verify',sessionResponseSchema.extend({recoveryCodes:z.array(z.string()).optional()}),mfaVerifySchema,{public:true});
add('auth','post','/auth/contact-changes',otpChallengeResponseSchema,z.object({contact:contactSchema}).strict(),{status:202,policy:'Owner plus recent authentication, origin and CSRF. New contact must be proved; other sessions are revoked on confirmation.'});
add('auth','post','/auth/contact-changes/{challengeId}/confirm',z.object({updated:z.literal(true)}),z.object({code:z.string().regex(/^\d{6}$/)}).strict());
for(const [owner,base] of [['restaurant','/seller/applications'],['rider','/rider/application']]) {
  add(owner!,'get',base!,z.array(applicationSchema));
  add(owner!,'post',base!,applicationSchema,applicationSaveSchema,{status:201});
  add(owner!,'patch',`${base}/{applicationId}`,applicationSchema,applicationUpdateSchema);
  add(owner!,'post',`${base}/{applicationId}/submit`,applicationSchema,applicationSubmitSchema,{idempotent:true,policy:'Owner with version check, validated required business/vehicle fields and owner-bound scanned documents. Membership remains customer until approved.'});
}
const operation=z.object({operationId:z.string().uuid(),applicationId:z.string().uuid(),state:z.enum(['PENDING','APPLIED','FAILED']),requiresMfa:z.boolean(),error:z.string().nullable(),attempts:z.number(),result:applicationSchema.nullable(),updatedAt:z.string().datetime()});
add('admin','post','/admin/verifications/{applicationId}/decision',operation,decisionSchema,{status:202,idempotent:true,policy:'Admin verifications:write plus MFA within 5 minutes, no self-review. Origin/CSRF, reason and expectedVersion required. APPLIED alone confirms completion; durable operation retries owner/role-grant failures.'});
add('admin','get','/admin/operations/{operationId}',operation,undefined,{policy:'Admin verifications:read with MFA.'});
add('admin','post','/admin/operations/{operationId}/retry',operation,empty,{status:202,policy:'Admin verifications:write with fresh MFA, origin and CSRF; self-review and concurrent conflicting decisions denied.'});
writeFileSync('contracts/identity.openapi.json',JSON.stringify(paths,null,2)+'\n');
