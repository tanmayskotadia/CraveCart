import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { unlink, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { adminPermissions } from '../../services/auth/src/router.js';
import { totp } from '../../services/auth/src/totp.js';

test('real accounts, documents, MFA and both partner approvals', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const zoneIds: string[] = [];
  const prefix = `browser-${randomUUID()}`;
  const adminContact = `${prefix}-admin@example.test`;
  const adminId = randomUUID();
  const mongo = new MongoClient(
    process.env.IDENTITY_TEST_MONGO_URI ??
      'mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0',
  );
  await mongo.connect();
  const auth = mongo.db('cravecart_auth');
  // Synthetic test-only verifier, isolated by UUID; never a public/default admin.
  await auth.collection('users').insertOne({
    _id: adminId as never,
    contact: adminContact,
    name: 'Browser Verifier',
    roles: ['customer', 'admin'],
    permissions: adminPermissions,
    status: 'ACTIVE',
    createdAt: new Date(),
  });
  const contexts = [];
  async function signIn(target: Page, path: string, email: string, signup = false) {
    await target.goto(path);
    const dialog = target.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Continue with email', exact: true }).click();
    if (signup) await dialog.getByLabel('Full name').fill('Browser Partner');
    await dialog.getByLabel('Email address').fill(email);
    await dialog.getByRole('button', { name: 'Continue with email', exact: true }).click();
    const banner = dialog.getByTestId('development-code');
    await expect(banner).toBeVisible();
    expect(await banner.textContent()).toContain('No SMS or email');
    await dialog.locator('#auth-code').fill((await banner.locator('strong').innerText()).trim());
    await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  }
  try {
    await signIn(page, '/signup', `${prefix}-customer@example.test`, true);
    await expect(page).toHaveURL(/\/search\?city=/);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello,');
    await page.goto('/profile');
    await page.goto('/admin/dashboard');
    await expect(
      page.getByRole('heading', { name: 'This workspace isn’t available to you.' }),
    ).toBeVisible();

    const adminContext = await browser.newContext({ viewport: page.viewportSize()! });
    contexts.push(adminContext);
    const admin = await adminContext.newPage();
    await signIn(admin, '/admin/login', adminContact);
    await expect(admin.getByAltText('Authenticator enrollment QR code')).toBeVisible();
    const secret = await admin.getByTestId('totp-secret').textContent();
    await admin.locator('#auth-code').fill(totp(secret!.trim()));
    await admin.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(admin.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await admin.getByRole('button', { name: 'I’ve saved my recovery codes' }).click();
    await expect(admin.getByRole('heading', { name: 'Verification overview' })).toBeVisible();

    const bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    for (const kind of ['seller', 'rider'] as const) {
      const context = await browser.newContext({ viewport: page.viewportSize()! });
      contexts.push(context);
      const partner = await context.newPage();
      await signIn(partner, `/${kind}/register`, `${prefix}-${kind}@example.test`, true);
      await expect(partner).toHaveURL(new RegExp(`/${kind}/onboarding$`));
      await partner.getByLabel('City', { exact: true }).selectOption('chennai');
      await partner.getByLabel('PIN code').fill('600001');
      if (kind === 'seller')
        await partner.getByLabel('Restaurant or business name').fill(`${prefix} Kitchen`);
      await partner
        .getByLabel(kind === 'seller' ? 'Business address' : 'Address', { exact: true })
        .fill('123 Test Street, Chennai');
      await partner
        .getByLabel('Verification document', { exact: true })
        .setInputFiles({ name: 'verification.png', mimeType: 'image/png', buffer: bytes });
      await expect(partner.getByText('Development checked', { exact: true })).toBeVisible();
      await partner.getByRole('button', { name: 'Submit for verification' }).click();
      await expect(
        partner.getByRole('heading', { name: 'Your application is with our verification team.' }),
      ).toBeVisible();
      const me = await partner.request.get('/api/v1/auth/me');
      const user = (await me.json()).data.principal;
      const app = await mongo
        .db(kind === 'seller' ? 'cravecart_restaurant' : 'cravecart_rider')
        .collection('applications')
        .findOne({ userId: user.userId });
      expect(app).toBeTruthy();
      await admin.goto(`/admin/verifications/${app!._id}`);
      await admin.getByRole('button', { name: 'View document 1' }).click();
      await expect(admin.getByRole('dialog', { name: 'Verification document' })).toBeVisible();
      await admin.getByRole('button', { name: 'Close dialog' }).click();
      await admin
        .getByLabel('Reason, visible to the applicant')
        .fill('Browser verification reviewed and approved');
      await admin.getByRole('button', { name: 'Confirm decision' }).click();
      await expect(admin.getByRole('heading', { name: 'Review operation: applied' })).toBeVisible();
      await partner.reload();
      await expect(partner.getByRole('link', { name: 'Open your workspace' })).toBeVisible();
      await partner.getByRole('link', { name: 'Open your workspace' }).click();
      await expect(partner.getByRole('heading', { level: 1 })).toContainText(
        kind === 'seller' ? 'Your restaurants' : 'Delivery partner',
      );
      expect(
        await partner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (kind === 'seller') {
        const restaurantId = String(app!._id);
        await partner.getByRole('link', { name: 'Restaurant details', exact: true }).click();
        await partner.getByLabel('Latitude', { exact: true }).fill('13.08');
        await partner.getByLabel('Longitude', { exact: true }).fill('80.27');
        for (const day of [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ]) {
          await partner.getByLabel(day, { exact: true }).check();
          await partner.getByLabel(`${day} opens 1`, { exact: true }).fill('00:00');
          await partner.getByLabel(`${day} closes 1`, { exact: true }).fill('00:00');
        }
        await partner.getByRole('button', { name: 'Save restaurant', exact: true }).click();
        await expect(partner.getByText('Restaurant details saved.', { exact: true })).toBeVisible();
        await partner.goto(`/seller/restaurants/${restaurantId}/menu/new`);
        await partner.getByLabel('Dish name', { exact: true }).fill('Browser Test Biryani');
        await partner.getByLabel('Base price (₹)', { exact: true }).fill('150');
        await partner
          .getByLabel('Declared allergens (comma separated)', { exact: true })
          .pressSequentially('Milk, Eggs');
        await partner.getByRole('button', { name: 'Add variant', exact: true }).click();
        await partner.getByLabel('Option 1 name', { exact: true }).fill('Regular');
        await partner.getByRole('button', { name: 'Add group', exact: true }).click();
        const group = partner.getByRole('group', { name: 'Add-on group 1', exact: true });
        await group.getByLabel('Group 1 name', { exact: true }).fill('Sides');
        await group.getByLabel('Minimum choices', { exact: true }).fill('1');
        await group.getByLabel('Option 1 name', { exact: true }).fill('Raita');
        await group.getByLabel('Option 1 extra price (₹)', { exact: true }).fill('20');
        await partner.getByRole('button', { name: 'Save dish', exact: true }).click();
        await expect(partner.getByRole('table')).toContainText('Browser Test Biryani');
        await partner.getByRole('link', { name: 'Restaurant details', exact: true }).click();
        await partner.getByLabel('Publish this restaurant and menu', { exact: true }).check();
        await partner.getByRole('button', { name: 'Save restaurant', exact: true }).click();
        await expect(partner.getByText('Restaurant details saved.', { exact: true })).toBeVisible();
        const details = await partner.request.get(
          `/api/v1/seller/restaurants/${restaurantId}/catalog`,
        );
        const slug = (await details.json()).data.restaurant.slug;
        const me = await admin.request.get('/api/v1/auth/me');
        const csrf = (await me.json()).data.csrfToken;
        const zone = await admin.request.post('/api/v1/admin/zones', {
          headers: { Origin: 'http://localhost:5173', 'X-CSRF-Token': csrf },
          data: {
            zone: {
              name: `${prefix} zone`,
              city: 'chennai',
              active: true,
              polygon: {
                type: 'Polygon',
                coordinates: [
                  [
                    [80.2, 13],
                    [80.35, 13],
                    [80.35, 13.2],
                    [80.2, 13.2],
                    [80.2, 13],
                  ],
                ],
              },
              hours: Array.from({ length: 7 }, (_, day) => ({
                day,
                openMinute: 0,
                closeMinute: 1440,
              })),
              feePolicyVersion: 1,
              deliveryFeeMinor: 3000,
              travelMinutesMin: 10,
              travelMinutesMax: 20,
            },
            reason: 'Temporary browser workflow zone',
          },
        });
        expect(zone.status(), await zone.text()).toBe(201);
        zoneIds.push((await zone.json()).data.id);
        await page.addInitScript(() =>
          Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: {
              getCurrentPosition: (_success: unknown, error: (value: { code: number }) => void) =>
                error({ code: 1 }),
            },
          }),
        );
        await page.goto('/addresses/new', { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Use my current location', exact: true }).click();
        await expect(
          page.getByText('Location permission was denied or unavailable.', { exact: false }),
        ).toBeVisible();
        await page.getByLabel('Indian mobile number', { exact: true }).fill('9876543210');
        await page.getByLabel('PIN code', { exact: true }).fill('600001');
        await page.getByLabel('City', { exact: true }).selectOption('chennai');
        await page
          .getByLabel('Street address', { exact: true })
          .fill('123 Browser Test Street, Chennai');
        await page.getByLabel('Latitude', { exact: true }).fill('13.081');
        await page.getByLabel('Longitude', { exact: true }).fill('80.271');
        await page.getByRole('button', { name: 'Check this pin', exact: true }).click();
        await expect(
          page.getByText('This pin is inside an active operating zone.', { exact: false }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Save address', exact: true }).click();
        await expect(page).toHaveURL(/\/addresses$/);
        await page.goto(`/search?city=chennai&q=${prefix}`);
        await page.getByRole('link', { name: new RegExp(`${prefix} Kitchen`) }).click();
        await expect(page).toHaveURL(new RegExp(`/restaurants/${slug}$`));
        await expect(
          page.getByText('Seller-declared allergens: Milk, Eggs', { exact: true }),
        ).toBeVisible();
        await page.getByRole('link', { name: 'Main course', exact: true }).click();
        await expect(page).toHaveURL(/#category-0$/);
        await page.getByRole('button', { name: 'Save restaurant', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Saved to favourites', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Add +', exact: true }).click();
        const choices = page.getByRole('dialog');
        await expect(choices.getByRole('button', { name: /Add to cart/ })).toBeDisabled();
        await choices.getByLabel(/Raita/).check();
        await choices.getByRole('button', { name: 'Add to cart · ₹170', exact: true }).click();
        await expect(page.getByText('Added to your cart.', { exact: false })).toBeVisible();
        await page.goto('/cart');
        await expect(page.getByRole('heading', { name: 'Browser Test Biryani' })).toBeVisible();
        await page
          .getByRole('button', { name: 'Increase Browser Test Biryani', exact: true })
          .click();
        await expect(page.locator('.subtotal-row')).toContainText('₹340');
        await page.getByRole('link', { name: 'Proceed to checkout', exact: true }).click();
        await page.getByRole('button', { name: 'Review final total', exact: true }).click();
        await expect(page.getByText('Development checkout', { exact: false })).toBeVisible();
        if (testInfo.project.name === 'mobile')
          await page.getByLabel('Stripe', { exact: true }).check();
        await page.getByRole('button', { name: /Continue to payment ·/ }).click();
        await expect(page).toHaveURL(/\/orders\/[a-f0-9-]{36}$/);
        await page.getByRole('button', { name: /Continue payment with/ }).click();
        await page.getByRole('button', { name: 'Simulate declined payment', exact: true }).click();
        await expect(page.getByText('DEVELOPMENT_PAYMENT_DECLINED', { exact: true })).toBeVisible();
        await page
          .getByRole('button', { name: 'Simulate successful payment', exact: true })
          .click();
        await expect(page.locator('.commerce-status')).toContainText('PLACED · CAPTURED');
        await page.reload();
        await expect(page.locator('.commerce-status')).toContainText('PLACED · CAPTURED');
        await mkdir('.local/qa', { recursive: true });
        await page.screenshot({
          path: `.local/qa/receipt-${testInfo.project.name}.png`,
          animations: 'disabled',
          fullPage: true,
        });
        await page.getByRole('button', { name: 'Review cancellation', exact: true }).click();
        await page
          .getByLabel('Cancellation reason', { exact: true })
          .fill('Browser test cancellation');
        await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
        await expect(page.locator('.commerce-status')).toContainText('CANCELLED');
        await expect(page.locator('.commerce-status')).toContainText('REFUNDED', {
          timeout: 30000,
        });
        await admin.goto('/admin/finance');
        await expect(
          admin.getByRole('heading', { name: 'Finance & reconciliation', exact: true }),
        ).toBeVisible();
        await expect(admin.getByText('Missing postings: 0', { exact: false })).toBeVisible();
        await expect(
          admin.getByRole('heading', { name: 'Pricing policy', exact: true }),
        ).toBeVisible();
        await admin.screenshot({
          path: `.local/qa/finance-${testInfo.project.name}.png`,
          animations: 'disabled',
          fullPage: true,
        });
        await page.goto('/orders');
        await expect(
          page.getByRole('heading', { name: `${prefix} Kitchen`, exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await mkdir('.local/qa', { recursive: true });
        await page.screenshot({
          path: `.local/qa/cart-${testInfo.project.name}.png`,
          animations: 'disabled',
          fullPage: true,
        });
        await page.goto(`/restaurants/${slug}`);
        await page.screenshot({
          path: `.local/qa/menu-${testInfo.project.name}.png`,
          animations: 'disabled',
          fullPage: true,
        });
      }
    }
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    const users = await auth
      .collection('users')
      .find({ contact: { $regex: `^${prefix}-` } })
      .toArray();
    const ids = users.map((user) => String(user._id));
    const applicationIds: string[] = [];
    for (const owner of ['restaurant', 'rider']) {
      const collection = mongo.db(`cravecart_${owner}`).collection('applications');
      const applications = await collection.find({ userId: { $in: ids } }).toArray();
      applicationIds.push(...applications.map((app) => String(app._id)));
      await collection.deleteMany({ userId: { $in: ids } });
    }
    const uploads = mongo.db('cravecart_utils').collection('uploads');
    for (const file of await uploads.find({ userId: { $in: ids } }).toArray()) {
      if (/^[0-9a-f-]{36}$/.test(String(file._id)))
        await unlink(resolve('.local/uploads', `${file._id}.encrypted`)).catch(() => {});
    }
    await uploads.deleteMany({ userId: { $in: ids } });
    const commerce = mongo.db('cravecart_restaurant');
    for (const name of ['restaurants', 'favorites'])
      await commerce.collection(name).deleteMany({ userId: { $in: ids } });
    const testOrders = await commerce
      .collection('orders')
      .find({ userId: { $in: ids } })
      .toArray();
    const orderIds = testOrders.map((order) => String(order._id));
    const utils = mongo.db('cravecart_utils');
    for (const name of ['payment_attempts', 'captures', 'refunds'])
      await utils.collection(name).deleteMany({ userId: { $in: ids } });
    await utils.collection('ledger').deleteMany({ orderId: { $in: orderIds } });
    await utils.collection('outbox').deleteMany({ 'event.data.orderId': { $in: orderIds } });
    for (const name of ['orders', 'quotes', 'refund_intents'])
      await commerce.collection(name).deleteMany({ userId: { $in: ids } });
    await commerce.collection('outbox').deleteMany({ 'event.data.orderId': { $in: orderIds } });
    await commerce.collection('carts').deleteMany({ _id: { $in: ids } as never });
    for (const name of ['menu_items', 'offers'])
      await commerce.collection(name).deleteMany({ restaurantId: { $in: applicationIds } });
    await auth.collection('addresses').deleteMany({ userId: { $in: ids } });
    await mongo
      .db('cravecart_admin')
      .collection('zones')
      .deleteMany({ _id: { $in: zoneIds } as never });
    for (const owner of ['auth', 'restaurant'])
      await mongo
        .db(`cravecart_${owner}`)
        .collection('outbox')
        .deleteMany({ 'event.aggregate.id': { $in: [...ids, ...applicationIds] } });

    for (const name of ['sessions', 'refresh_tokens', 'mfa_challenges'])
      await auth.collection(name).deleteMany({ userId: { $in: ids } });
    await auth.collection('users').deleteMany({ contact: { $regex: `^${prefix}-` } });
    const admin = mongo.db('cravecart_admin');
    for (const name of ['verification_cases', 'verification_operations'])
      await admin
        .collection(name)
        .deleteMany(
          name === 'verification_cases'
            ? { _id: { $in: applicationIds } as never }
            : { applicationId: { $in: applicationIds } },
        );
    await admin
      .collection('audit')
      .deleteMany({ $or: [{ actorId: { $in: ids } }, { applicationId: { $in: applicationIds } }] });
    await mongo.close();
  }
});
