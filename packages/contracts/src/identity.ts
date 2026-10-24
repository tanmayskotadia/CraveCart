import { z } from 'zod';

export const roleSchema = z.enum(['customer','seller','rider','admin']);
export const contactSchema = z.string().trim().max(254).transform(value => value.includes('@') ? value.toLowerCase() : value.replace(/[\s()-]/g,'').replace(/^(?:\+91|91)(?=\d{10}$)/,'')).refine(value => /^[6-9]\d{9}$/.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Enter a valid Indian mobile number or email address');
export const otpRequestSchema = z.object({contact:contactSchema,name:z.string().trim().min(2).max(80).optional(),workspace:roleSchema.default('customer'),intent:z.enum(['login','register']).default('login')}).strict();
export const otpVerifySchema = z.object({challengeId:z.string().min(32).max(128),code:z.string().regex(/^\d{6}$/)}).strict();
export const principalSchema = z.object({userId:z.string().uuid(),sessionId:z.string().uuid(),name:z.string(),contact:z.string(),roles:z.array(roleSchema),permissions:z.array(z.string()),workspace:roleSchema,mfaEnabled:z.boolean(),mfaVerifiedAt:z.string().datetime().nullable(),authenticatedAt:z.string().datetime()}).strict();
export type Principal = z.infer<typeof principalSchema>;
export const sessionResponseSchema = z.object({principal:principalSchema,csrfToken:z.string().min(32),accessExpiresAt:z.string().datetime()}).strict();
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export const otpChallengeResponseSchema = z.object({challengeId:z.string(),expiresAt:z.string().datetime(),resendAfterSeconds:z.number(),delivery:z.enum(['development','email','sms']),developmentCode:z.string().optional()}).strict();
export const loginResultSchema = z.union([sessionResponseSchema,z.object({mfaChallengeId:z.string(),enrollmentRequired:z.boolean()}).strict()]);
export const mfaEnrollSchema = z.object({mfaChallengeId:z.string().min(32)}).strict();
export const mfaVerifySchema = z.object({mfaChallengeId:z.string().min(32),code:z.string().trim().min(6).max(32)}).strict();
export const applicationProfileSchema = z.object({
  fullName:z.string().trim().min(2).max(80),city:z.string().regex(/^[a-z][a-z-]{1,60}$/),
  address:z.string().trim().min(10).max(500),pincode:z.string().regex(/^[1-9]\d{5}$/),
  businessName:z.string().trim().min(2).max(120).optional(),
  vehicleType:z.enum(['bicycle','scooter','motorbike','car']).optional(),
  vehicleRegistration:z.string().trim().max(30).optional(),
}).strict();
export type ApplicationProfile = z.infer<typeof applicationProfileSchema>;
export const applicationSaveSchema = z.object({profile:applicationProfileSchema,documentIds:z.array(z.string().uuid()).min(1).max(5)}).strict();
export const applicationUpdateSchema = applicationSaveSchema.extend({expectedVersion:z.number().int().positive()}).strict();
export const applicationSubmitSchema = z.object({expectedVersion:z.number().int().positive()}).strict();
export const decisionSchema = z.object({expectedVersion:z.number().int().positive(),decision:z.enum(['approved','rejected','changes-requested']),reason:z.string().trim().min(5).max(1000)}).strict();
export const applicationSchema = z.object({id:z.string().uuid(),userId:z.string().uuid(),kind:z.enum(['seller','rider']),status:z.enum(['DRAFT','SUBMITTED','APPROVED','REJECTED','CHANGES_REQUESTED']),version:z.number().int().positive(),profile:applicationProfileSchema,documentIds:z.array(z.string().uuid()),createdAt:z.string(),updatedAt:z.string(),reason:z.string().optional(),grantState:z.enum(['NOT_REQUESTED','PENDING','APPLIED']).optional()}).strict();
export type Application = z.infer<typeof applicationSchema>;
export const uploadIntentSchema = z.object({filename:z.string().trim().min(1).max(160),purpose:z.enum(['seller-verification','rider-verification']),size:z.number().int().positive().max(5*1024*1024)}).strict();
