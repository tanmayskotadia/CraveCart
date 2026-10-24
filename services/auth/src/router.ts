import { randomInt, randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { MongoServerError, type ClientSession } from 'mongodb';
import {
  contactSchema,
  otpRequestSchema,
  otpVerifySchema,
  mfaEnrollSchema,
  mfaVerifySchema,
  type Principal,
} from '@cravecart/contracts';
import {
  HttpError,
  hash,
  opaque,
  mac,
  equal,
  seal,
  unseal,
  cookieNames,
  cookies,
  csrfToken,
  requireCsrf,
  requireOrigin,
  internalOnly,
  currentPrincipal,
  requirePermission,
  json,
  checkedId,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
import { enqueueEvent } from '@cravecart/persistence';
import { newTotpSecret, matchingCounter } from './totp.js';

export interface IdentityUser {
  _id: string;
  contact: string;
  name: string;
  roles: Principal['roles'];
  permissions: string[];
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: Date;
  mfaSecret?: string;
  backupHashes?: string[];
  lastTotpCounter?: number;
}
interface SessionRecord {
  _id: string;
  userId: string;
  accessHash: string;
  accessExpiresAt: Date;
  expiresAt: Date;
  workspace: Principal['workspace'];
  createdAt: Date;
  authenticatedAt: Date;
  mfaVerifiedAt: Date | null;
  revokedAt: Date | null;
}
interface RefreshRecord {
  _id: string;
  sessionId: string;
  state: 'ACTIVE' | 'USED';
  expiresAt: Date;
}
interface Challenge {
  _id: string;
  contact: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  used: boolean;
  name?: string;
  workspace: Principal['workspace'];
  intent: 'login' | 'register' | 'contact-change';
  userId?: string;
}
interface MfaChallenge {
  _id: string;
  userId: string;
  workspace: Principal['workspace'];
  expiresAt: Date;
  attempts: number;
  used: boolean;
  sessionId?: string;
  pendingSecret?: string;
  enrollmentRequired: boolean;
}
interface Limit {
  _id: string;
  count: number;
  expiresAt: Date;
}
const ACCESS_MS = 15 * 60_000,
  FAMILY_MS = 30 * 24 * 60 * 60_000;
export const adminPermissions = [
  'zones:read',
  'zones:write',
  'verifications:read',
  'verifications:write',
  'users:read',
  'users:write',
  'audit:read',
];

export function installAuth(app: Express, ctx: DomainContext) {
  const { db, client, config } = ctx;
  const users = db.collection<IdentityUser>('users'),
    sessions = db.collection<SessionRecord>('sessions'),
    refreshes = db.collection<RefreshRecord>('refresh_tokens'),
    challenges = db.collection<Challenge>('challenges'),
    mfaChallenges = db.collection<MfaChallenge>('mfa_challenges');
  const ready = lazyIndexes(async () => {
    await users.createIndex({ contact: 1 }, { unique: true });
    await sessions.createIndex({ accessHash: 1 }, { unique: true });
    for (const collection of [
      sessions,
      refreshes,
      challenges,
      mfaChallenges,
      db.collection('auth_limits'),
      db.collection('internal_nonces'),
    ])
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await sessions.createIndex({ userId: 1, createdAt: -1 });
  });
  const router = express.Router();
  router.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (error) {
      next(error);
    }
  });
  function publicUser(user: IdentityUser, session: SessionRecord): Principal {
    return {
      userId: user._id,
      sessionId: session._id,
      name: user.name,
      contact: user.contact,
      roles: user.roles,
      permissions: user.permissions,
      workspace: session.workspace,
      mfaEnabled: Boolean(user.mfaSecret),
      mfaVerifiedAt: session.mfaVerifiedAt?.toISOString() ?? null,
      authenticatedAt: session.authenticatedAt.toISOString(),
    };
  }
  async function loadSession(req: Request, allowRefresh = false) {
    const names = cookieNames(config),
      values = cookies(req);
    let session: SessionRecord | null = null;
    if (values[names.access])
      session = await sessions.findOne({
        accessHash: hash(values[names.access]!),
        accessExpiresAt: { $gt: new Date() },
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
    if (!session && allowRefresh && values[names.refresh]) {
      const token = await refreshes.findOne({
        _id: hash(values[names.refresh]!),
        state: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      });
      if (token)
        session = await sessions.findOne({
          _id: token.sessionId,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        });
    }
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const user = await users.findOne({ _id: session.userId, status: 'ACTIVE' });
    if (!user) throw new HttpError(401, 'SESSION_REVOKED', 'This session is no longer available');
    if (!user.roles.includes(session.workspace))
      throw new HttpError(403, 'WORKSPACE_REVOKED', 'This workspace is no longer available');
    return { user, session };
  }
  const authenticated =
    (mutation = false, allowRefresh = false): RequestHandler =>
    async (req, res, next) => {
      try {
        const value = await loadSession(req, allowRefresh);
        if (mutation) requireCsrf(req, config, value.session._id);
        res.locals.identity = value;
        res.locals.principal = publicUser(value.user, value.session);
        next();
      } catch (error) {
        next(error);
      }
    };
  function recent(principal: Principal) {
    if (
      Date.now() - Date.parse(principal.authenticatedAt) > 300_000 &&
      (!principal.mfaVerifiedAt || Date.now() - Date.parse(principal.mfaVerifiedAt) > 300_000)
    )
      throw new HttpError(
        403,
        'REAUTH_REQUIRED',
        'Sign in again before changing security settings',
      );
  }
  function setCookies(res: Response, access: string, refresh: string, expiresAt: Date) {
    const base = {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
    const names = cookieNames(config);
    res.cookie(names.access, access, { ...base, maxAge: ACCESS_MS });
    res.cookie(names.refresh, refresh, {
      ...base,
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }
  function clearCookies(res: Response) {
    const base = {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
    for (const name of Object.values(cookieNames(config))) res.clearCookie(name, base);
  }
  async function newSession(
    user: IdentityUser,
    workspace: Principal['workspace'],
    mfa: boolean,
    transaction: ClientSession,
  ) {
    const access = opaque(),
      refresh = opaque(),
      now = new Date();
    const actualWorkspace = user.roles.includes(workspace) ? workspace : 'customer';
    const session: SessionRecord = {
      _id: randomUUID(),
      userId: user._id,
      accessHash: hash(access),
      accessExpiresAt: new Date(Date.now() + ACCESS_MS),
      expiresAt: new Date(Date.now() + FAMILY_MS),
      workspace: actualWorkspace,
      createdAt: now,
      authenticatedAt: now,
      mfaVerifiedAt: mfa ? now : null,
      revokedAt: null,
    };
    await sessions.insertOne(session, { session: transaction });
    await refreshes.insertOne(
      { _id: hash(refresh), sessionId: session._id, state: 'ACTIVE', expiresAt: session.expiresAt },
      { session: transaction },
    );
    return { session, access, refresh };
  }
  function sessionData(user: IdentityUser, session: SessionRecord) {
    return {
      principal: publicUser(user, session),
      csrfToken: csrfToken(config, session._id),
      accessExpiresAt: session.accessExpiresAt.toISOString(),
    };
  }
  async function limit(scope: string, target: string, max: number, windowMs: number) {
    const bucket = Math.floor(Date.now() / windowMs);
    const record = await db
      .collection<Limit>('auth_limits')
      .findOneAndUpdate(
        { _id: mac(config.AUTH_SECRET, `${scope}:${target}:${bucket}`) },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) } },
        { upsert: true, returnDocument: 'after' },
      );
    if (record && record.count > max)
      throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later');
  }
  function clientIp(req: Request) {
    const ip = req.get('x-cc-client-ip'),
      time = req.get('x-cc-ip-time') ?? '',
      proof = req.get('x-cc-ip-proof') ?? '';
    return ip &&
      Math.abs(Date.now() - Number(time)) < 30000 &&
      equal(proof, mac(config.INTERNAL_TOKEN, `auth:${time}:${ip}`))
      ? ip
      : (req.ip ?? 'unknown');
  }
  const development = config.NODE_ENV !== 'production' && config.DEV_ADAPTERS === 'true';
  function deliveryMode(contact: string) {
    if (development) return 'development' as const;
    if (contact.includes('@') && config.SMTP_URL && config.SMTP_FROM) return 'email' as const;
    if (
      !contact.includes('@') &&
      config.TWILIO_ACCOUNT_SID &&
      config.TWILIO_AUTH_TOKEN &&
      config.TWILIO_FROM_NUMBER
    )
      return 'sms' as const;
    throw new HttpError(
      503,
      'DELIVERY_UNAVAILABLE',
      'This sign-in method is not configured yet',
      true,
    );
  }
  async function requestCode(
    req: Request,
    input: z.infer<typeof otpRequestSchema>,
    intent: Challenge['intent'] = input.intent,
    userId?: string,
  ) {
    const delivery = deliveryMode(input.contact);
    await limit('ip', clientIp(req), config.NODE_ENV === 'test' ? 500 : 30, 15 * 60_000);
    await limit('contact', input.contact, config.NODE_ENV === 'test' ? 100 : 5, 60 * 60_000);
    const cooldown = db.collection<{ _id: string; nextAllowedAt: Date }>('otp_cooldowns');
    const cooldownId = mac(config.AUTH_SECRET, input.contact);
    try {
      const result = await cooldown.updateOne(
        { _id: cooldownId, nextAllowedAt: { $lte: new Date() } },
        { $set: { nextAllowedAt: new Date(Date.now() + 45_000) } },
        { upsert: true },
      );
      if (!result.matchedCount && !result.upsertedCount) throw new Error('Cooldown');
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new HttpError(429, 'OTP_COOLDOWN', 'Wait 45 seconds before requesting another code');
      throw error;
    }
    const id = opaque(),
      code = String(randomInt(100000, 1000000)),
      expiresAt = new Date(Date.now() + 300_000);
    await challenges.updateMany({ contact: input.contact, used: false }, { $set: { used: true } });
    await challenges.insertOne({
      _id: hash(id),
      contact: input.contact,
      codeHash: mac(config.AUTH_SECRET, `${id}:${code}`),
      expiresAt,
      attempts: 0,
      used: false,
      workspace: input.workspace,
      intent,
      ...(input.name ? { name: input.name } : {}),
      ...(userId ? { userId } : {}),
    });
    try {
      if (delivery === 'email')
        await nodemailer.createTransport(config.SMTP_URL!).sendMail({
          from: config.SMTP_FROM,
          to: input.contact,
          subject: 'Your CraveCart verification code',
          text: `Your CraveCart code is ${code}. It expires in 5 minutes. If you did not request this code, ignore this email.`,
        });
      if (delivery === 'sms') {
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.TWILIO_ACCOUNT_SID!)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              authorization: `Basic ${Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: config.TWILIO_FROM_NUMBER!,
              To: `+91${input.contact}`,
              Body: `Your CraveCart code is ${code}. Expires in 5 minutes.`,
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) throw new Error('Provider rejected');
      }
    } catch {
      await challenges.updateOne({ _id: hash(id) }, { $set: { used: true } });
      throw new HttpError(
        503,
        'DELIVERY_FAILED',
        'The verification message could not be delivered. Please try again later',
        true,
      );
    }
    return {
      challengeId: id,
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: 45,
      delivery,
      ...(development ? { developmentCode: code } : {}),
    };
  }
  async function checkedChallenge(id: string, code: string, intent?: Challenge['intent']) {
    const value = await challenges.findOneAndUpdate(
      {
        _id: hash(id),
        used: false,
        attempts: { $lt: 5 },
        expiresAt: { $gt: new Date() },
        ...(intent ? { intent } : {}),
      },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!value || !equal(value.codeHash, mac(config.AUTH_SECRET, `${id}:${code}`)))
      throw new HttpError(
        401,
        'INVALID_CODE',
        'That code is invalid, expired, or has already been used',
      );
    return value;
  }
  router.get('/capabilities', (_req, res) =>
    json(res, {
      methods: [
        ...(development ||
        (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM_NUMBER)
          ? ['phone']
          : []),
        ...(development || (config.SMTP_URL && config.SMTP_FROM) ? ['email'] : []),
      ],
      developmentDelivery: development,
    }),
  );
  router.post(['/otp/request', '/register', '/login'], async (req, res) => {
    requireOrigin(req, config);
    const body = otpRequestSchema.parse({
      ...req.body,
      ...(req.path === '/register' ? { intent: 'register' } : {}),
    });
    if (body.intent === 'register' && body.workspace === 'admin')
      throw new HttpError(403, 'FORBIDDEN', 'Administrator accounts cannot be registered publicly');
    if (body.intent === 'register' && !body.name)
      throw new HttpError(400, 'NAME_REQUIRED', 'Enter your name');
    json(res, await requestCode(req, body), 202);
  });
  router.post('/otp/verify', async (req, res) => {
    requireOrigin(req, config);
    const body = otpVerifySchema.parse(req.body);
    const challenge = await checkedChallenge(body.challengeId, body.code);
    if (challenge.intent === 'contact-change')
      throw new HttpError(400, 'WRONG_CHALLENGE', 'Use the contact-change confirmation flow');
    const transaction = client.startSession();
    try {
      const result = await transaction.withTransaction(async () => {
        const used = await challenges.updateOne(
          { _id: challenge._id, used: false, expiresAt: { $gt: new Date() } },
          { $set: { used: true } },
          { session: transaction },
        );
        if (!used.modifiedCount)
          throw new HttpError(401, 'INVALID_CODE', 'This code has already been used');
        let user = await users.findOne({ contact: challenge.contact }, { session: transaction });
        if (!user) {
          if (challenge.intent !== 'register' || challenge.workspace === 'admin')
            throw new HttpError(409, 'ACCOUNT_NOT_FOUND', 'Create an account before signing in');
          user = {
            _id: randomUUID(),
            contact: challenge.contact,
            name: challenge.name!,
            roles: ['customer'],
            permissions: [],
            status: 'ACTIVE',
            createdAt: new Date(),
          };
          await users.insertOne(user, { session: transaction });
        }
        if (user.status !== 'ACTIVE')
          throw new HttpError(
            403,
            'ACCOUNT_SUSPENDED',
            'This account is suspended. Contact support',
          );
        if (challenge.workspace === 'admin' && !user.roles.includes('admin'))
          throw new HttpError(403, 'FORBIDDEN', 'This account does not have team access');
        if (user.mfaSecret || challenge.workspace === 'admin') {
          const id = opaque();
          await mfaChallenges.insertOne(
            {
              _id: hash(id),
              userId: user._id,
              workspace: challenge.workspace,
              expiresAt: new Date(Date.now() + 300_000),
              attempts: 0,
              used: false,
              enrollmentRequired: !user.mfaSecret,
            },
            { session: transaction },
          );
          return { user, mfaChallengeId: id, enrollmentRequired: !user.mfaSecret };
        }
        return { user, ...(await newSession(user, challenge.workspace, false, transaction)) };
      });
      if (!result) throw new Error('Login transaction failed');
      if ('mfaChallengeId' in result) {
        json(res, {
          mfaChallengeId: result.mfaChallengeId,
          enrollmentRequired: result.enrollmentRequired,
        });
        return;
      }
      setCookies(res, result.access, result.refresh, result.session.expiresAt);
      json(res, sessionData(result.user, result.session));
    } finally {
      await transaction.endSession();
    }
  });
  router.get('/me', authenticated(), (_req, res) => {
    const { user, session } = res.locals.identity as { user: IdentityUser; session: SessionRecord };
    json(res, sessionData(user, session));
  });
  router.get('/csrf', authenticated(false, true), (_req, res) =>
    json(res, { csrfToken: csrfToken(config, currentPrincipal(res).sessionId) }),
  );
  router.patch('/me', authenticated(true), async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(2).max(80) })
      .strict()
      .parse(req.body);
    await users.updateOne({ _id: currentPrincipal(res).userId }, { $set: body });
    json(res, { ...currentPrincipal(res), name: body.name });
  });
  router.post('/refresh', async (req, res) => {
    requireOrigin(req, config);
    const raw = cookies(req)[cookieNames(config).refresh];
    if (!raw) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const token = await refreshes.findOne({ _id: hash(raw), expiresAt: { $gt: new Date() } });
    if (!token) throw new HttpError(401, 'SESSION_EXPIRED', 'Sign in again');
    requireCsrf(req, config, token.sessionId);
    const transaction = client.startSession();
    try {
      const result = await transaction.withTransaction(async () => {
        const current = await refreshes.findOne({ _id: token._id }, { session: transaction });
        const session = await sessions.findOne(
          { _id: token.sessionId, revokedAt: null, expiresAt: { $gt: new Date() } },
          { session: transaction },
        );
        if (!session) return { error: true as const };
        if (!current || current.state !== 'ACTIVE') {
          await sessions.updateOne(
            { _id: session._id },
            { $set: { revokedAt: new Date() } },
            { session: transaction },
          );
          return { error: true as const };
        }
        const user = await users.findOne(
          { _id: session.userId, status: 'ACTIVE' },
          { session: transaction },
        );
        if (!user) return { error: true as const };
        const access = opaque(),
          refresh = opaque();
        await refreshes.updateOne(
          { _id: current._id, state: 'ACTIVE' },
          { $set: { state: 'USED' } },
          { session: transaction },
        );
        await refreshes.insertOne(
          {
            _id: hash(refresh),
            sessionId: session._id,
            state: 'ACTIVE',
            expiresAt: session.expiresAt,
          },
          { session: transaction },
        );
        session.accessHash = hash(access);
        session.accessExpiresAt = new Date(
          Math.min(Date.now() + ACCESS_MS, session.expiresAt.getTime()),
        );
        await sessions.updateOne(
          { _id: session._id },
          { $set: { accessHash: session.accessHash, accessExpiresAt: session.accessExpiresAt } },
          { session: transaction },
        );
        return { session, user, access, refresh };
      });
      if (!result || 'error' in result) {
        clearCookies(res);
        throw new HttpError(
          401,
          'SESSION_REVOKED',
          'Session expired or refresh reuse detected. Sign in again',
        );
      }
      setCookies(res, result.access, result.refresh, result.session.expiresAt);
      json(res, sessionData(result.user, result.session));
    } finally {
      await transaction.endSession();
    }
  });
  router.post('/logout', authenticated(true, true), async (_req, res) => {
    await sessions.updateOne(
      { _id: currentPrincipal(res).sessionId },
      { $set: { revokedAt: new Date() } },
    );
    clearCookies(res);
    json(res, { loggedOut: true });
  });
  router.get('/sessions', authenticated(), async (_req, res) =>
    json(
      res,
      (
        await sessions
          .find({
            userId: currentPrincipal(res).userId,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
          })
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray()
      ).map((value) => ({
        id: value._id,
        current: value._id === currentPrincipal(res).sessionId,
        workspace: value.workspace,
        createdAt: value.createdAt.toISOString(),
        expiresAt: value.expiresAt.toISOString(),
      })),
    ),
  );
  router.delete('/sessions/:sessionId', authenticated(true), async (req, res) => {
    const result = await sessions.updateOne(
      { _id: checkedId(req.params.sessionId), userId: currentPrincipal(res).userId },
      { $set: { revokedAt: new Date() } },
    );
    if (!result.matchedCount) throw new HttpError(404, 'NOT_FOUND', 'Session not found');
    if (req.params.sessionId === currentPrincipal(res).sessionId) clearCookies(res);
    json(res, { revoked: true });
  });
  router.post('/sessions/revoke-all', authenticated(true), async (_req, res) => {
    recent(currentPrincipal(res));
    await sessions.updateMany(
      { userId: currentPrincipal(res).userId },
      { $set: { revokedAt: new Date() } },
    );
    clearCookies(res);
    json(res, { revoked: true });
  });
  router.post('/workspace', authenticated(true), async (req, res) => {
    const { workspace } = z
      .object({ workspace: z.enum(['customer', 'seller', 'rider', 'admin']) })
      .strict()
      .parse(req.body);
    const principal = currentPrincipal(res);
    if (!principal.roles.includes(workspace))
      throw new HttpError(403, 'FORBIDDEN', 'This workspace has not been granted');
    if (workspace === 'admin') requirePermission(principal, 'verifications:read', true);
    await sessions.updateOne({ _id: principal.sessionId }, { $set: { workspace } });
    json(res, { workspace });
  });
  router.post('/mfa/challenge', authenticated(true), async (_req, res) => {
    const principal = currentPrincipal(res);
    if (!principal.mfaEnabled) recent(principal);
    const id = opaque();
    await mfaChallenges.insertOne({
      _id: hash(id),
      userId: principal.userId,
      workspace: principal.workspace,
      sessionId: principal.sessionId,
      expiresAt: new Date(Date.now() + 300_000),
      attempts: 0,
      used: false,
      enrollmentRequired: !principal.mfaEnabled,
    });
    json(res, { mfaChallengeId: id, enrollmentRequired: !principal.mfaEnabled });
  });
  router.post('/mfa/enroll', async (req, res) => {
    requireOrigin(req, config);
    const body = mfaEnrollSchema.parse(req.body);
    const challenge = await mfaChallenges.findOne({
      _id: hash(body.mfaChallengeId),
      used: false,
      enrollmentRequired: true,
      expiresAt: { $gt: new Date() },
    });
    if (!challenge)
      throw new HttpError(401, 'INVALID_CHALLENGE', 'Authenticator enrollment has expired');
    if (challenge.sessionId) {
      const current = await loadSession(req);
      requireCsrf(req, config, current.session._id);
      if (current.session._id !== challenge.sessionId)
        throw new HttpError(401, 'INVALID_CHALLENGE', 'This enrollment belongs to another session');
    }
    const user = await users.findOne({ _id: challenge.userId, status: 'ACTIVE' });
    if (!user || user.mfaSecret)
      throw new HttpError(409, 'ALREADY_ENROLLED', 'This enrollment is not available');
    if (!challenge.pendingSecret)
      await mfaChallenges.updateOne(
        { _id: challenge._id, pendingSecret: { $exists: false } },
        {
          $set: {
            pendingSecret: seal(Buffer.from(newTotpSecret()), config.AUTH_ENCRYPTION_KEY).toString(
              'base64',
            ),
          },
        },
      );
    const stored = await mfaChallenges.findOne({
      _id: challenge._id,
      used: false,
      expiresAt: { $gt: new Date() },
    });
    if (!stored?.pendingSecret)
      throw new HttpError(401, 'INVALID_CHALLENGE', 'Authenticator enrollment has expired');
    const secret = unseal(
      Buffer.from(stored.pendingSecret, 'base64'),
      config.AUTH_ENCRYPTION_KEY,
    ).toString();
    json(res, {
      secret,
      uri: `otpauth://totp/CraveCart:${encodeURIComponent(user.contact)}?secret=${secret}&issuer=CraveCart&algorithm=SHA1&digits=6&period=30`,
    });
  });
  router.post('/mfa/verify', async (req, res) => {
    requireOrigin(req, config);
    const body = mfaVerifySchema.parse(req.body);
    const challenge = await mfaChallenges.findOneAndUpdate(
      {
        _id: hash(body.mfaChallengeId),
        used: false,
        attempts: { $lt: 5 },
        expiresAt: { $gt: new Date() },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!challenge)
      throw new HttpError(401, 'INVALID_CHALLENGE', 'Authenticator verification has expired');
    await limit('mfa', challenge.userId, 20, 15 * 60_000);
    if (challenge.sessionId) {
      const current = await loadSession(req);
      requireCsrf(req, config, current.session._id);
      if (current.session._id !== challenge.sessionId)
        throw new HttpError(
          401,
          'INVALID_CHALLENGE',
          'This verification belongs to another session',
        );
    }
    const transaction = client.startSession();
    try {
      const result = await transaction.withTransaction(async () => {
        const user = await users.findOne(
          { _id: challenge.userId, status: 'ACTIVE' },
          { session: transaction },
        );
        if (!user) throw new HttpError(401, 'SESSION_REVOKED', 'This account is unavailable');
        const encrypted = user.mfaSecret ?? challenge.pendingSecret;
        if (!encrypted)
          throw new HttpError(400, 'ENROLLMENT_REQUIRED', 'Set up your authenticator first');
        const secret = unseal(
          Buffer.from(encrypted, 'base64'),
          config.AUTH_ENCRYPTION_KEY,
        ).toString();
        const counter = matchingCounter(secret, body.code, user.lastTotpCounter ?? -1);
        const backupHash = mac(config.AUTH_SECRET, `backup:${body.code}`);
        const backup = user.mfaSecret && user.backupHashes?.includes(backupHash);
        if (counter === null && !backup)
          throw new HttpError(
            401,
            'INVALID_MFA_CODE',
            'Authenticator code is invalid or has already been used',
          );
        const update: Partial<IdentityUser> = {};
        let recoveryCodes: string[] | undefined;
        if (counter !== null) update.lastTotpCounter = counter;
        if (!user.mfaSecret) {
          recoveryCodes = Array.from({ length: 8 }, () => opaque().slice(0, 20));
          update.mfaSecret = encrypted;
          update.backupHashes = recoveryCodes.map((value) =>
            mac(config.AUTH_SECRET, `backup:${value}`),
          );
        } else if (backup)
          update.backupHashes = user.backupHashes!.filter((value) => value !== backupHash);
        const consumed = await mfaChallenges.updateOne(
          { _id: challenge._id, used: false },
          { $set: { used: true } },
          { session: transaction },
        );
        if (!consumed.modifiedCount)
          throw new HttpError(401, 'INVALID_MFA_CODE', 'This challenge was already used');
        // User-document conflicts serialize reuse of the same TOTP/recovery code across challenges.
        await users.updateOne({ _id: user._id }, { $set: update }, { session: transaction });
        Object.assign(user, update);
        if (challenge.sessionId) {
          const session = await sessions.findOne(
            {
              _id: challenge.sessionId,
              userId: user._id,
              revokedAt: null,
              expiresAt: { $gt: new Date() },
            },
            { session: transaction },
          );
          if (!session) throw new HttpError(401, 'SESSION_REVOKED', 'Sign in again');
          session.mfaVerifiedAt = new Date();
          await sessions.updateOne(
            { _id: session._id },
            { $set: { mfaVerifiedAt: session.mfaVerifiedAt } },
            { session: transaction },
          );
          return { user, session, recoveryCodes };
        }
        return {
          user,
          ...(await newSession(user, challenge.workspace, true, transaction)),
          recoveryCodes,
        };
      });
      if (!result) throw new Error('MFA transaction failed');
      if ('access' in result)
        setCookies(res, result.access!, result.refresh!, result.session.expiresAt);
      json(res, {
        ...sessionData(result.user, result.session),
        ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}),
      });
    } finally {
      await transaction.endSession();
    }
  });
  router.post('/contact-changes', authenticated(true), async (req, res) => {
    const principal = currentPrincipal(res);
    recent(principal);
    const { contact } = z.object({ contact: contactSchema }).strict().parse(req.body);
    json(
      res,
      await requestCode(
        req,
        { contact, workspace: principal.workspace, intent: 'login' },
        'contact-change',
        principal.userId,
      ),
      202,
    );
  });
  router.post('/contact-changes/:challengeId/confirm', authenticated(true), async (req, res) => {
    const principal = currentPrincipal(res);
    recent(principal);
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(req.body);
    const challenge = await checkedChallenge(
      String(req.params.challengeId),
      code,
      'contact-change',
    );
    if (challenge.userId !== principal.userId)
      throw new HttpError(404, 'NOT_FOUND', 'Challenge not found');
    const transaction = client.startSession();
    try {
      await transaction.withTransaction(async () => {
        const consumed = await challenges.updateOne(
          { _id: challenge._id, used: false },
          { $set: { used: true } },
          { session: transaction },
        );
        if (!consumed.modifiedCount)
          throw new HttpError(401, 'INVALID_CODE', 'Code was already used');
        try {
          await users.updateOne(
            { _id: principal.userId },
            { $set: { contact: challenge.contact } },
            { session: transaction },
          );
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11000)
            throw new HttpError(409, 'CONTACT_UNAVAILABLE', 'That contact cannot be used');
          throw error;
        }
        await sessions.updateMany(
          { userId: principal.userId, _id: { $ne: principal.sessionId } },
          { $set: { revokedAt: new Date() } },
          { session: transaction },
        );
      });
      json(res, { updated: true });
    } finally {
      await transaction.endSession();
    }
  });
  app.use('/api/v1/auth', router);
  const internal = express.Router();
  internal.use(internalOnly(ctx, ['auth', 'restaurant', 'rider', 'admin', 'utils', 'realtime']));
  internal.post('/addresses/get', async (req, res) => {
    if (res.locals.caller !== 'restaurant')
      throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ userId: z.string().uuid(), addressId: z.string().uuid() })
      .strict()
      .parse(req.body);
    const address = await db
      .collection('addresses')
      .findOne({ _id: input.addressId as never, userId: input.userId });
    if (!address) throw new HttpError(404, 'ADDRESS_NOT_FOUND', 'Choose a saved delivery address');
    const { _id: _id, userId: _userId, ...value } = address;
    json(res, value);
  });
  internal.post('/memberships/check', async (req, res) => {
    if (res.locals.caller !== 'restaurant')
      throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ userIds: z.array(z.string().uuid()).min(1).max(1000) })
      .strict()
      .parse(req.body);
    const active = await users
      .find(
        { _id: { $in: input.userIds }, status: 'ACTIVE', roles: 'seller' },
        { projection: { _id: 1 } },
      )
      .toArray();
    json(res, { activeUserIds: active.map((user) => user._id) });
  });
  internal.post('/sessions/inspect', async (req, res) => {
    const body = z
      .object({ accessToken: z.string().optional(), sessionId: z.string().uuid().optional() })
      .strict()
      .refine((value) => Boolean(value.accessToken) !== Boolean(value.sessionId))
      .parse(req.body);
    const session = await sessions.findOne({
      ...(body.accessToken
        ? { accessHash: hash(body.accessToken), accessExpiresAt: { $gt: new Date() } }
        : { _id: body.sessionId }),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Session is no longer available');
    const user = await users.findOne({ _id: session.userId, status: 'ACTIVE' });
    if (!user) throw new HttpError(401, 'SESSION_REVOKED', 'Session is no longer available');
    json(res, publicUser(user, session));
  });
  internal.post('/roles/apply', async (req, res) => {
    const body = z
      .object({
        grantId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['seller', 'rider']),
        actorSessionId: z.string().uuid(),
        applicationId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    if (
      (res.locals.caller === 'restaurant'
        ? 'seller'
        : res.locals.caller === 'rider'
          ? 'rider'
          : null) !== body.role
    )
      throw new HttpError(403, 'SERVICE_DENIED', 'This service cannot grant that role');
    const approvingSession = await sessions.findOne({
      _id: body.actorSessionId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    const approver =
      approvingSession && (await users.findOne({ _id: approvingSession.userId, status: 'ACTIVE' }));
    if (!approvingSession || !approver)
      throw new HttpError(403, 'APPROVER_UNAVAILABLE', 'The approver must sign in again');
    requirePermission(publicUser(approver, approvingSession), 'verifications:write', true);
    if (approver._id === body.userId)
      throw new HttpError(403, 'SELF_APPROVAL_DENIED', 'You cannot approve your own application');
    const transaction = client.startSession();
    try {
      await transaction.withTransaction(async () => {
        const user = await users.findOne(
          { _id: body.userId, status: 'ACTIVE' },
          { session: transaction },
        );
        if (!user) throw new HttpError(409, 'APPLICANT_UNAVAILABLE', 'Applicant is unavailable');
        if (!user.roles.includes(body.role)) {
          await users.updateOne(
            { _id: user._id },
            { $addToSet: { roles: body.role } },
            { session: transaction },
          );
          await enqueueEvent(db, transaction, {
            eventId: body.grantId,
            eventType: 'identity.roles-changed.v1',
            schemaVersion: 1,
            occurredAt: new Date().toISOString(),
            producer: 'auth',
            aggregate: { type: 'user', id: user._id, version: Date.now() },
            correlationId: body.applicationId,
            causationId: body.grantId,
            data: { userId: user._id, grantVersion: Date.now() },
          });
        }
      });
      json(res, { applied: true });
    } finally {
      await transaction.endSession();
    }
  });
  internal.post('/users/list', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const body = z
      .object({
        actorSessionId: z.string().uuid(),
        status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
      })
      .strict()
      .parse(req.body);
    const session = await sessions.findOne({
        _id: body.actorSessionId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }),
      user = session && (await users.findOne({ _id: session.userId, status: 'ACTIVE' }));
    if (!session || !user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in again');
    requirePermission(publicUser(user, session), 'users:read');
    json(
      res,
      (
        await users
          .find(body.status ? { status: body.status } : {})
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray()
      ).map(({ _id, name, contact, roles, status, createdAt }) => ({
        id: _id,
        name,
        contact,
        roles,
        status,
        createdAt,
      })),
    );
  });
  internal.post('/users/status', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const body = z
      .object({
        actorSessionId: z.string().uuid(),
        userId: z.string().uuid(),
        status: z.enum(['ACTIVE', 'SUSPENDED']),
        reason: z.string().min(5).max(1000),
      })
      .strict()
      .parse(req.body);
    const session = await sessions.findOne({
        _id: body.actorSessionId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }),
      user = session && (await users.findOne({ _id: session.userId, status: 'ACTIVE' }));
    if (!session || !user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in again');
    requirePermission(publicUser(user, session), 'users:write', true);
    if (user._id === body.userId)
      throw new HttpError(409, 'SELF_CHANGE_DENIED', 'You cannot suspend your own account');
    const transaction = client.startSession();
    try {
      await transaction.withTransaction(async () => {
        const changed = await users.updateOne(
          { _id: body.userId },
          { $set: { status: body.status } },
          { session: transaction },
        );
        if (!changed.matchedCount) throw new HttpError(404, 'NOT_FOUND', 'Account not found');
        if (body.status === 'SUSPENDED') {
          await sessions.updateMany(
            { userId: body.userId },
            { $set: { revokedAt: new Date() } },
            { session: transaction },
          );
          await enqueueEvent(db, transaction, {
            eventId: randomUUID(),
            eventType: 'identity.suspended.v1',
            schemaVersion: 1,
            occurredAt: new Date().toISOString(),
            producer: 'auth',
            aggregate: { type: 'user', id: body.userId, version: Date.now() },
            correlationId: String(res.locals.requestId),
            causationId: session._id,
            data: { userId: body.userId, reason: body.reason },
          });
        }
      });
    } finally {
      await transaction.endSession();
    }
    json(res, { updated: true });
  });
  app.use(
    '/internal/v1',
    async (_req, _res, next) => {
      try {
        await ready();
        next();
      } catch (error) {
        next(error);
      }
    },
    internal,
  );
}
