import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
import sharp from 'sharp';
import { z } from 'zod';
import { uploadIntentSchema } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  HttpError,
  hash,
  opaque,
  equal,
  seal,
  unseal,
  checkedId,
  internalOnly,
  json,
  requirePermission,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';

interface Upload {
  _id: string;
  userId: string;
  purpose: 'seller-verification' | 'rider-verification' | 'catalog-image';
  publicCatalogImage?: boolean;
  filename: string;
  size: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  status: 'INTENDED' | 'WRITING' | 'QUARANTINED' | 'CLEAN' | 'DEVELOPMENT_REVIEWABLE' | 'REJECTED';
  mime?: string;
  applicationId?: string;
  scanMethod?: string;
}
const EICAR = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
async function clamScan(buffer: Buffer, host: string, port: number) {
  return new Promise<boolean>((resolveScan, reject) => {
    const socket = createConnection({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error: Error | null, clean = false) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolveScan(clean);
    };
    socket.setTimeout(10_000, () => finish(new Error('Scanner timeout')));
    socket.on('error', () => finish(new Error('Scanner unavailable')));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
        const chunk = buffer.subarray(offset, offset + 64 * 1024),
          size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      const answer = Buffer.concat(chunks).toString();
      if (answer.includes('\0'))
        finish(
          answer.includes(' FOUND')
            ? null
            : answer.includes(': OK')
              ? null
              : new Error('Scanner rejected stream'),
          answer.includes(': OK'),
        );
    });
    socket.on('end', () => {
      if (!settled) finish(new Error('Incomplete scan result'));
    });
  });
}
export function installUploads(app: Express, ctx: DomainContext) {
  const { db, config } = ctx;
  const uploads = db.collection<Upload>('uploads');
  const directory = resolve(config.UPLOAD_DIRECTORY);
  const ready = lazyIndexes(async () => {
    await mkdir(directory, { recursive: true });
    await uploads.createIndex({ userId: 1, createdAt: -1 });
    await db.collection('internal_nonces').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
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
  router.post('/intents', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const input = uploadIntentSchema.parse(req.body);
    if (input.purpose === 'catalog-image' && !currentPrincipal(res).roles.includes('seller'))
      throw new HttpError(403, 'FORBIDDEN', 'Only verified sellers can upload catalog images');
    const uploadId = randomUUID(),
      token = opaque(),
      expiresAt = new Date(Date.now() + 10 * 60_000);
    await uploads.insertOne({
      _id: uploadId,
      userId: currentPrincipal(res).userId,
      purpose: input.purpose,
      filename: Array.from(input.filename)
        .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
        .join('')
        .slice(0, 160),
      size: input.size,
      tokenHash: hash(token),
      expiresAt,
      createdAt: new Date(),
      status: 'INTENDED',
    });
    json(
      res,
      {
        uploadId,
        uploadToken: token,
        url: `/api/v1/uploads/${uploadId}/content`,
        expiresAt: expiresAt.toISOString(),
        maxBytes: 5 * 1024 * 1024,
      },
      201,
    );
  });
  router.put('/:uploadId/content', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const id = checkedId(req.params.uploadId),
      principal = currentPrincipal(res);
    const upload = await uploads.findOne({
      _id: id,
      userId: principal.userId,
      status: 'INTENDED',
      expiresAt: { $gt: new Date() },
    });
    if (!upload || !equal(hash(req.get('x-upload-token') ?? ''), upload.tokenHash))
      throw new HttpError(404, 'UPLOAD_UNAVAILABLE', 'Upload is unavailable or expired');
    if (
      !Buffer.isBuffer(req.body) ||
      !req.body.length ||
      req.body.length !== upload.size ||
      req.body.length > 5 * 1024 * 1024
    )
      throw new HttpError(422, 'INVALID_FILE', 'The file size does not match this upload');
    const buffer = req.body as Buffer;
    let mime: string | undefined;
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      mime = 'image/png';
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
    else if (
      buffer.subarray(0, 5).toString() === '%PDF-' &&
      buffer.subarray(-2048).includes(Buffer.from('%%EOF'))
    )
      mime = 'application/pdf';
    if (!mime || buffer.includes(Buffer.from(EICAR)))
      throw new HttpError(422, 'UNSAFE_FILE', 'Only valid PNG, JPEG or PDF documents are accepted');
    if (upload.purpose === 'catalog-image' && !mime.startsWith('image/'))
      throw new HttpError(422, 'IMAGE_REQUIRED', 'Catalog photos must be PNG or JPEG');
    if (mime.startsWith('image/')) {
      try {
        const metadata = await sharp(buffer, { limitInputPixels: 20_000_000 }).metadata();
        if (!metadata.width || !metadata.height) throw new Error('Empty image');
        await sharp(buffer, { limitInputPixels: 20_000_000 }).stats();
      } catch {
        throw new HttpError(422, 'INVALID_FILE', 'This image cannot be decoded safely');
      }
    }
    const claimed = await uploads.updateOne(
      { _id: id, status: 'INTENDED' },
      { $set: { status: 'WRITING' } },
    );
    if (!claimed.modifiedCount)
      throw new HttpError(409, 'UPLOAD_USED', 'This upload has already been used');
    try {
      await writeFile(
        resolve(directory, `${id}.encrypted`),
        seal(buffer, config.UPLOAD_ENCRYPTION_KEY),
        { flag: 'wx', mode: 0o600 },
      );
      await uploads.updateOne(
        { _id: id, status: 'WRITING' },
        { $set: { status: 'QUARANTINED', mime } },
      );
    } catch {
      await uploads.updateOne({ _id: id, status: 'WRITING' }, { $set: { status: 'REJECTED' } });
      throw new HttpError(
        503,
        'UPLOAD_FAILED',
        'Upload failed. Create a new upload and try again',
        true,
      );
    }
    json(res, { uploadId: id, status: 'QUARANTINED' }, 201);
  });
  router.post('/:uploadId/complete', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const id = checkedId(req.params.uploadId);
    const upload = await uploads.findOne({ _id: id, userId: currentPrincipal(res).userId });
    if (!upload) throw new HttpError(404, 'NOT_FOUND', 'Upload not found');
    if (['CLEAN', 'DEVELOPMENT_REVIEWABLE'].includes(upload.status)) {
      json(res, { uploadId: id, status: upload.status, scanMethod: upload.scanMethod });
      return;
    }
    if (upload.status !== 'QUARANTINED')
      throw new HttpError(409, 'UPLOAD_NOT_READY', 'Upload is not ready to scan');
    const bytes = unseal(
      await readFile(resolve(directory, `${id}.encrypted`)),
      config.UPLOAD_ENCRYPTION_KEY,
    );
    let clean: boolean;
    if (config.UPLOAD_SCAN_MODE === 'development') {
      if (config.NODE_ENV === 'production' || config.DEV_ADAPTERS !== 'true')
        throw new HttpError(503, 'SCANNER_UNAVAILABLE', 'Malware scanning is unavailable');
      clean = !bytes.includes(Buffer.from(EICAR));
    } else {
      try {
        clean = await clamScan(bytes, config.CLAMD_HOST, config.CLAMD_PORT);
      } catch {
        throw new HttpError(
          503,
          'SCANNER_UNAVAILABLE',
          'The document remains quarantined. Retry scanning later',
          true,
        );
      }
    }
    const status = clean
      ? config.UPLOAD_SCAN_MODE === 'development'
        ? 'DEVELOPMENT_REVIEWABLE'
        : 'CLEAN'
      : 'REJECTED';
    await uploads.updateOne(
      { _id: id, status: 'QUARANTINED' },
      { $set: { status, scanMethod: config.UPLOAD_SCAN_MODE } },
    );
    if (!clean) {
      await unlink(resolve(directory, `${id}.encrypted`)).catch(() => {});
      throw new HttpError(422, 'UNSAFE_FILE', 'The document was rejected by malware scanning');
    }
    json(res, { uploadId: id, status, scanMethod: config.UPLOAD_SCAN_MODE });
  });
  async function authorizedUpload(id: string, principal: ReturnType<typeof currentPrincipal>) {
    const upload = await uploads.findOne({ _id: id });
    if (!upload) throw new HttpError(404, 'NOT_FOUND', 'Upload not found');
    if (upload.userId !== principal.userId) {
      requirePermission(principal, 'verifications:read', true);
      if (!upload.applicationId)
        throw new HttpError(404, 'NOT_FOUND', 'Document is not attached to an application');
    }
    if (
      upload.status !== 'CLEAN' &&
      !(
        config.NODE_ENV !== 'production' &&
        config.DEV_ADAPTERS === 'true' &&
        upload.status === 'DEVELOPMENT_REVIEWABLE'
      )
    )
      throw new HttpError(
        409,
        'DOCUMENT_QUARANTINED',
        'This document is not available for viewing',
      );
    return upload;
  }
  router.get('/:uploadId/access', remoteSession(ctx), async (req, res) => {
    const upload = await authorizedUpload(checkedId(req.params.uploadId), currentPrincipal(res));
    json(res, {
      url: `/api/v1/uploads/${upload._id}/content`,
      filename: upload.filename,
      mime: upload.mime,
      status: upload.status,
    });
  });
  router.get('/:uploadId/content', remoteSession(ctx), async (req, res) => {
    const upload = await authorizedUpload(checkedId(req.params.uploadId), currentPrincipal(res));
    await db.collection('document_accesses').insertOne({
      uploadId: upload._id,
      actorId: currentPrincipal(res).userId,
      at: new Date(),
      requestId: res.locals.requestId,
    });
    const bytes = unseal(
      await readFile(resolve(directory, `${upload._id}.encrypted`)),
      config.UPLOAD_ENCRYPTION_KEY,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="verification-document.${upload.mime === 'application/pdf' ? 'pdf' : upload.mime === 'image/png' ? 'png' : 'jpg'}"`,
    );
    res.setHeader('Content-Type', upload.mime ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  });
  app.use('/api/v1/uploads', router);
  app.post(
    '/internal/v1/uploads/catalog-bind',
    internalOnly(ctx, ['restaurant']),
    async (req, res) => {
      await ready();
      const input = z
        .object({ uploadId: z.string().uuid(), userId: z.string().uuid() })
        .strict()
        .parse(req.body);
      const file = await uploads.findOne({
        _id: input.uploadId,
        userId: input.userId,
        purpose: 'catalog-image',
      });
      if (
        !file ||
        !file.mime?.startsWith('image/') ||
        !(
          file.status === 'CLEAN' ||
          (config.NODE_ENV !== 'production' &&
            config.DEV_ADAPTERS === 'true' &&
            file.status === 'DEVELOPMENT_REVIEWABLE')
        )
      )
        throw new HttpError(422, 'IMAGE_NOT_READY', 'Choose your own checked catalog image');
      await uploads.updateOne(
        { _id: input.uploadId, userId: input.userId },
        { $set: { publicCatalogImage: true } },
      );
      json(res, { bound: true });
    },
  );
  app.get('/api/v1/media/:uploadId', async (req, res) => {
    await ready();
    const file = await uploads.findOne({
      _id: checkedId(req.params.uploadId),
      purpose: 'catalog-image',
      publicCatalogImage: true,
    });
    if (
      !file ||
      !file.mime?.startsWith('image/') ||
      !(
        file.status === 'CLEAN' ||
        (config.NODE_ENV !== 'production' &&
          config.DEV_ADAPTERS === 'true' &&
          file.status === 'DEVELOPMENT_REVIEWABLE')
      )
    )
      throw new HttpError(404, 'NOT_FOUND', 'Image unavailable');
    const original = unseal(
      await readFile(resolve(directory, `${file._id}.encrypted`)),
      config.UPLOAD_ENCRYPTION_KEY,
    );
    const bytes = await sharp(original, { limitInputPixels: 20_000_000 })
      .rotate()
      .resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  });
  app.post(
    '/internal/v1/uploads/bind',
    internalOnly(ctx, ['restaurant', 'rider']),
    async (req, res) => {
      await ready();
      const body = z
        .object({
          userId: z.string().uuid(),
          applicationId: z.string().uuid(),
          documentIds: z.array(z.string().uuid()).min(1).max(5),
        })
        .strict()
        .parse(req.body);
      const purpose =
        res.locals.caller === 'restaurant' ? 'seller-verification' : 'rider-verification';
      const records = await uploads
        .find({ _id: { $in: body.documentIds }, userId: body.userId, purpose })
        .toArray();
      if (
        records.length !== new Set(body.documentIds).size ||
        records.some(
          (file) =>
            (file.status !== 'CLEAN' &&
              !(
                config.NODE_ENV !== 'production' &&
                config.DEV_ADAPTERS === 'true' &&
                file.status === 'DEVELOPMENT_REVIEWABLE'
              )) ||
            (file.applicationId && file.applicationId !== body.applicationId),
        )
      )
        throw new HttpError(
          422,
          'DOCUMENTS_NOT_READY',
          'Documents must belong to this account and pass the configured scan',
        );
      await uploads.updateMany(
        {
          _id: { $in: body.documentIds },
          userId: body.userId,
          $or: [{ applicationId: { $exists: false } }, { applicationId: body.applicationId }],
        },
        { $set: { applicationId: body.applicationId } },
      );
      json(res, { bound: true });
    },
  );
}
