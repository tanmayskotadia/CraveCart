import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { unlink, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { adminPermissions } from '../../services/auth/src/router.js';
import { totp } from '../../services/auth/src/totp.js';

test('customer, restaurant and rider complete a verified delivery', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const dbPrefix = process.env.BROWSER_DB_PREFIX;
  if (!dbPrefix || !/^cc_ui_[a-f0-9]+$/.test(dbPrefix))
    throw new Error('Run through the isolated browser runner');
  let merchantPage: Page | undefined,
    riderPage: Page | undefined,
    merchantId = '',
    paidOrderId = '';
  let receivedMovingLocation = false;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const frame = String(payload);
      if (!frame.startsWith('42')) return;
      try {
        const [event, value] = JSON.parse(frame.slice(2));
        if (
          event === 'delivery:snapshot' &&
          value.orderId === paidOrderId &&
          value.latestLocation?.point.latitude === 13.0801 &&
          value.latestLocation?.point.longitude === 80.2701
        )
          receivedMovingLocation = true;
      } catch {
        /* Ignore unrelated Engine.IO protocol frames. */
      }
    }),
  );
  const zoneIds: string[] = [];
  const prefix = `browser-${randomUUID()}`;
  const supportSubject = `Order receipt question · ${testInfo.project.name} · ${prefix}`;
  const adminContact = `${prefix}-admin@example.test`;
  const adminId = randomUUID();
  const mongo = new MongoClient(
    process.env.IDENTITY_TEST_MONGO_URI ??
      'mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0',
  );
  await mongo.connect();
  const auth = mongo.db(`${dbPrefix}_auth`);
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
  const browserErrors: string[] = [];
  async function walkWorkspace(target: Page, name: string) {
    const serviceFailures: string[] = [];
    const recordFailure = (response: import('@playwright/test').Response) => {
      if (response.status() >= 500 && new URL(response.url()).pathname.startsWith('/api/v1/'))
        serviceFailures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    };
    target.on('response', recordFailure);
    await target.goto('/workspaces');
    await expect(
      target.getByRole('heading', { name: 'Your workspaces', exact: true }),
    ).toBeVisible();
    const role = name === 'restaurant' ? 'seller' : name;
    await target.getByRole('button', { name: `Open ${role} workspace`, exact: true }).click();
    const home =
      role === 'seller'
        ? '/seller/restaurants'
        : role === 'rider'
          ? '/rider/dashboard'
          : role === 'admin'
            ? '/admin/dashboard'
            : '/profile';
    await expect.poll(() => new URL(target.url()).pathname).toBe(home);
    const current = await target.request.get('/api/v1/auth/me');
    expect((await current.json()).data.principal.workspace).toBe(role);
    const menu = target.getByRole('button', { name: 'Workspace menu', exact: true });
    const mobileMenu = (target.viewportSize()?.width ?? 1280) <= 640;
    if (mobileMenu) {
      await expect(menu).toBeVisible();
      await menu.click();
    }
    const navigation = target.getByRole('navigation', { name: 'Workspace navigation' });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Workspaces', exact: true })).toBeVisible();
    const links = await navigation
      .locator('a')
      .evaluateAll((anchors) =>
        anchors.map((a) => ({ label: a.textContent!, path: a.getAttribute('href')! })),
      );
    expect(links.length, `${name} must expose an actual workspace menu`).toBeGreaterThan(5);
    const visited: string[] = [];
    target.on('pageerror', (error) => browserErrors.push(`${name}: ${error.message}`));
    for (const link of links) {
      if (mobileMenu) {
        await expect(menu).toBeVisible();
        if ((await menu.getAttribute('aria-expanded')) === 'false') await menu.click();
      }
      await expect(navigation).toBeVisible();
      await navigation.getByRole('link', { name: link.label, exact: true }).click();
      await expect.poll(() => new URL(target.url()).pathname).toBe(link.path);
      await expect(target.locator('main h1').first()).toBeVisible();
      await expect(target.locator('.workspace-content [role="alert"]')).toHaveCount(0);
      await expect(target.locator('main')).not.toContainText(
        'This workspace feature is being prepared',
      );
      await expect(
        target.getByRole('heading', { name: 'Sign in to continue', exact: true }),
      ).toHaveCount(0);
      await expect(
        target.getByRole('heading', { name: 'We couldn’t find that page', exact: true }),
      ).toHaveCount(0);
      expect(
        await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name}: ${link.path}`,
      ).toBe(true);
      visited.push(new URL(target.url()).pathname);
    }
    target.off('response', recordFailure);
    expect(serviceFailures, `${name} workspace API failures`).toEqual([]);
    await writeFile(
      testInfo.outputPath(`workspace-walk-${name}.json`),
      JSON.stringify({ name, visited }, null, 2),
    );
  }
  async function audit(target: Page, name: string) {
    const results = await new AxeBuilder({ page: target })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const evidencePath = testInfo.outputPath(`accessibility-${name}.json`);
    await writeFile(evidencePath, JSON.stringify(results, null, 2));
    await testInfo.attach(`accessibility-${name}`, {
      path: evidencePath,
      contentType: 'application/json',
    });
    expect
      .soft(
        results.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      )
      .toEqual([]);
  }
  async function signIn(target: Page, path: string, email: string, signup = false) {
    await target.goto('/access');
    await target.locator(`main a[href="${path}"]`).click();
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
    await expect(page).toHaveURL(/\/search$/);
    await page.getByRole('button', { name: 'Choose a city', exact: false }).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('Chennai');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Chennai Tamil Nadu', exact: true })
      .click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Chennai.');
    await page.goto('/access');
    await expect(page.getByRole('link', { name: 'View restaurant application' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open administration workspace' })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Open customer workspace' }).click();
    await expect(page).toHaveURL(/\/profile$/);
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
    await admin.goto('/access');
    await admin.getByRole('button', { name: 'Open administration workspace' }).click();
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
      if (kind === 'seller') merchantPage = partner;
      else riderPage = partner;
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
        .db(`${dbPrefix}_${kind === 'seller' ? 'restaurant' : 'rider'}`)
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
        merchantId = restaurantId;
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
        await partner.addInitScript(() => {
          const original = AudioContext.prototype.createOscillator;
          AudioContext.prototype.createOscillator = function () {
            const root = document.documentElement;
            root.dataset.soundEvents = String(Number(root.dataset.soundEvents ?? '0') + 1);
            return original.call(this);
          };
        });
        await partner.goto(`/seller/restaurants/${restaurantId}/orders`);
        await expect(partner.getByText('Your kitchen is ready.', { exact: true })).toBeVisible();
        await partner
          .getByRole('button', { name: 'Enable sound notifications', exact: true })
          .click();
        const me = await admin.request.get('/api/v1/auth/me');
        const csrf = (await me.json()).data.csrfToken;
        const zone = await admin.request.post('/api/v1/admin/zones', {
          headers: { Origin: process.env.BROWSER_BASE_URL!, 'X-CSRF-Token': csrf },
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
        if (testInfo.project.name === 'mobile') {
          // Exercise a hosted setup with only Stripe enabled, rather than assuming Razorpay.
          await page.route('**/api/v1/payments/capabilities', async (route) => {
            const response = await route.fetch();
            const body = await response.json();
            body.data.gateways = ['stripe'];
            await route.fulfill({ response, json: body });
          });
          await page.reload();
          await page.getByRole('button', { name: 'Review final total', exact: true }).click();
          await expect(page.getByLabel('Stripe', { exact: true })).toBeChecked();
          await expect(page.getByLabel('Razorpay', { exact: true })).toHaveCount(0);
        }
        await page.getByRole('button', { name: /Continue to payment ·/ }).click();
        await expect(page).toHaveURL(/\/orders\/[a-f0-9-]{36}$/);
        paidOrderId = new URL(page.url()).pathname.split('/').at(-1)!;
        await page.getByRole('button', { name: /Continue payment with/ }).click();
        await page.getByRole('button', { name: 'Simulate declined payment', exact: true }).click();
        await expect(page.getByText('DEVELOPMENT_PAYMENT_DECLINED', { exact: true })).toBeVisible();
        await page
          .getByRole('button', { name: 'Simulate successful payment', exact: true })
          .click();
        await expect(page.locator('.commerce-status')).toContainText('PLACED · CAPTURED');
        const accountMenu = page.getByRole('button', { name: 'Workspace menu', exact: true });
        if (await accountMenu.isVisible()) await accountMenu.click();
        await page
          .getByRole('navigation', { name: 'Workspace navigation' })
          .getByRole('link', { name: 'My cart', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Your cart has room for a craving.', exact: true }),
        ).toBeVisible();
        if (await accountMenu.isVisible()) await accountMenu.click();
        await page
          .getByRole('navigation', { name: 'Workspace navigation' })
          .getByRole('link', { name: 'Orders', exact: true })
          .click();
        await page.getByRole('link', { name: 'View order', exact: true }).first().click();
        await expect(page.locator('.commerce-status')).toContainText('PLACED · CAPTURED');
        await expect(partner.locator('.kitchen-order .status-badge')).toContainText('PLACED', {
          timeout: 12000,
        });
        await expect
          .poll(() =>
            partner.evaluate(() => Number(document.documentElement.dataset.soundEvents ?? '0')),
          )
          .toBeGreaterThan(0);
        const inbox = await partner.request.get('/api/v1/notifications');
        expect(inbox.status()).toBe(200);
        expect(
          (await inbox.json()).data.some(
            (note: { href: string; title: string }) =>
              note.href.endsWith(paidOrderId) && note.title.includes('placed'),
          ),
        ).toBe(true);
        await page.reload();
        await expect(page.locator('.commerce-status')).toContainText('PLACED · CAPTURED');
        await mkdir('.local/qa', { recursive: true });
        await page.screenshot({
          path: `.local/qa/receipt-${testInfo.project.name}.png`,
          animations: 'disabled',
          fullPage: true,
        });
      }
    }
    if (!merchantPage || !riderPage || !paidOrderId) throw new Error('Missing browser actors');
    const kitchen = merchantPage,
      driver = riderPage;
    await kitchen.goto(`/seller/restaurants/${merchantId}/orders/${paidOrderId}`);
    await kitchen.getByRole('button', { name: 'Enable sound notifications', exact: true }).click();
    await kitchen.getByRole('button', { name: 'Accept order', exact: true }).click();
    await expect(kitchen.locator('.status-badge')).toContainText('ACCEPTED');
    await kitchen.getByRole('button', { name: 'Start preparing', exact: true }).click();
    await kitchen.getByRole('button', { name: 'Mark ready for pickup', exact: true }).click();
    await expect(kitchen.locator('.verification-code strong')).toBeVisible();
    await driver.context().grantPermissions(['geolocation']);
    await driver.context().setGeolocation({ latitude: 13.08, longitude: 80.27, accuracy: 10 });
    await driver.getByRole('button', { name: 'Go online and share location', exact: true }).click();
    await expect(driver.getByText('Location shared at', { exact: false })).toBeVisible();
    await driver
      .getByRole('button', { name: 'Accept delivery', exact: true })
      .click({ timeout: 45000 });
    await expect(driver.getByRole('link', { name: 'Open delivery', exact: true })).toBeVisible();
    await driver.getByRole('link', { name: 'Open delivery', exact: true }).click();
    await expect(driver.locator('.commerce-status')).toContainText('READY FOR PICKUP');
    await page.goto(`/orders/${paidOrderId}/track`);
    await expect(
      page.locator('.delivery-map .leaflet-overlay-pane svg path').first(),
    ).toBeVisible();
    await expect(page.locator('.commerce-status')).toContainText('READY FOR PICKUP');
    await audit(kitchen, 'seller-kitchen');
    await audit(driver, 'rider-task');
    await audit(page, 'customer-tracking');
    const customerMessages = await page.context().newPage(),
      riderMessages = await driver.context().newPage();
    await customerMessages.goto(`/orders/${paidOrderId}/messages`);
    await customerMessages
      .getByLabel('Message to delivery participant')
      .fill('Please use the main entrance.');
    await customerMessages
      .getByRole('button', { name: 'Send delivery message', exact: true })
      .click();
    await expect(
      customerMessages.getByText('Please use the main entrance.', { exact: true }),
    ).toBeVisible();
    await riderMessages.goto(`/orders/${paidOrderId}/messages`);
    await expect(
      riderMessages.getByText('Please use the main entrance.', { exact: true }),
    ).toBeVisible();
    await riderMessages
      .getByLabel('Message to delivery participant')
      .fill('Thank you, I will meet you there.');
    await riderMessages.getByRole('button', { name: 'Send delivery message', exact: true }).click();
    await expect(
      customerMessages.getByText('Thank you, I will meet you there.', { exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await customerMessages.close();
    await riderMessages.close();
    const pickup = (await kitchen.locator('.verification-code strong').innerText()).trim();
    await driver.getByLabel('Pickup code from restaurant', { exact: true }).fill('000000');
    await driver.getByRole('button', { name: 'Verify food pickup', exact: true }).click();
    await expect(
      driver.getByText('The verification code is incorrect', { exact: false }).first(),
    ).toBeVisible();
    await driver.getByLabel('Pickup code from restaurant', { exact: true }).fill(pickup);
    await driver.getByRole('button', { name: 'Verify food pickup', exact: true }).click();
    await expect(driver.locator('.commerce-status')).toContainText('PICKED UP');
    await driver.getByRole('button', { name: 'Start delivery', exact: true }).click();
    await expect(page.locator('.commerce-status')).toContainText('OUT FOR DELIVERY');
    const riderMe = (await (await driver.request.get('/api/v1/auth/me')).json()).data.principal;
    await expect
      .poll(async () => {
        const profile = await mongo
          .db(`${dbPrefix}_rider`)
          .collection('availability')
          .findOne({ _id: riderMe.userId });
        return Date.now() - Date.parse(profile!.receivedAt);
      })
      .toBeGreaterThan(4200);
    await driver.context().setGeolocation({ latitude: 13.0801, longitude: 80.2701, accuracy: 10 });
    await expect(page.getByText('Rider location updated', { exact: false })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('.delivery-map')).toHaveAttribute('data-rider-latitude', '13.0801', {
      timeout: 15000,
    });
    await expect(page.locator('.delivery-map')).toHaveAttribute('data-rider-longitude', '80.2701');
    await expect.poll(() => receivedMovingLocation, { timeout: 15000 }).toBe(true);
    await expect(
      driver.getByRole('link', { name: 'Open navigation to customer', exact: true }),
    ).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\//);
    await page.screenshot({
      path: `.local/qa/tracking-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await kitchen.screenshot({
      path: `.local/qa/kitchen-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await driver.screenshot({
      path: `.local/qa/rider-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await driver.getByText('Report a delivery problem', { exact: true }).click();
    await driver
      .getByLabel('Incident details', { exact: true })
      .fill('Browser fixture needs operator review');
    await driver.getByRole('button', { name: 'Submit incident for review', exact: true }).click();
    await admin.goto('/admin/delivery-operations');
    await expect(
      admin.getByText('Browser fixture needs operator review', { exact: true }),
    ).toBeVisible();
    await admin
      .getByLabel('Operator action reason', { exact: true })
      .fill('Reviewed the browser fixture and confirmed safe handover');
    await admin.getByRole('button', { name: 'Record incident resolution', exact: true }).click();
    await expect(admin.getByText('No open incidents.', { exact: true })).toBeVisible();
    const deliveryCode = (await page.locator('.verification-code strong').innerText()).trim();
    await driver.getByLabel('Delivery code from customer', { exact: true }).fill(deliveryCode);
    await driver.getByRole('button', { name: 'Verify delivery completion', exact: true }).click();
    await expect(page.locator('.commerce-status')).toContainText('DELIVERED');
    await expect(kitchen.locator('.status-badge')).toContainText('DELIVERED');
    await expect(
      page.getByText('Delivered. Rider-location sharing has ended.', { exact: true }),
    ).toBeVisible();
    for (const actor of [page, kitchen, driver])
      expect(
        await actor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    await page.screenshot({
      path: `.local/qa/delivered-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.goto(`/orders/${paidOrderId}`);
    await page.getByRole('button', { name: 'Review reorder', exact: true }).click();
    await page.getByLabel('I reviewed the current selections and prices', { exact: true }).check();
    await page.getByRole('button', { name: 'Confirm reorder to cart', exact: true }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(
      page.getByRole('heading', { name: 'Browser Test Biryani', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear cart', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm clear cart', exact: true }).click();
    await page.goto(`/orders/${paidOrderId}/review`);
    await page.getByRole('combobox', { name: 'Rating', exact: true }).selectOption('4');
    await page
      .getByLabel('Your review', { exact: true })
      .fill('Fresh biryani and a smooth delivery experience.');
    await page.getByRole('button', { name: 'Publish review', exact: true }).click();
    await expect(
      page.getByText('Fresh biryani and a smooth delivery experience.', { exact: true }),
    ).toBeVisible();
    await kitchen.goto(`/seller/restaurants/${merchantId}/reviews`);
    await kitchen
      .getByLabel('Restaurant reply', { exact: true })
      .fill('Thank you for ordering from our kitchen.');
    await kitchen.getByRole('button', { name: 'Save restaurant reply', exact: true }).click();
    await expect(
      kitchen.getByText('Thank you for ordering from our kitchen.', { exact: true }),
    ).toBeVisible();
    await page.goto(`/support?orderId=${paidOrderId}`);
    await page.getByLabel('Subject', { exact: true }).fill(supportSubject);
    await page
      .getByLabel('How can we help?', { exact: true })
      .fill('Could you help me understand my order receipt?');
    await page.getByRole('button', { name: 'Create support ticket', exact: true }).click();
    await page.getByRole('heading', { name: supportSubject, exact: true }).click();
    await expect(
      page.getByText('Could you help me understand my order receipt?', { exact: true }),
    ).toBeVisible();
    const ticketUrl = page.url();
    await admin.goto('/admin/support');
    await admin.getByRole('heading', { name: supportSubject, exact: true }).click();
    await admin
      .getByLabel('Message', { exact: true })
      .fill('Your verified receipt is available on the order page.');
    await admin.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.goto(ticketUrl);
    await expect(
      page.getByText('Your verified receipt is available on the order page.', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Closing reason', { exact: true })
      .fill('My receipt question has been answered');
    await page.getByRole('button', { name: 'Close ticket', exact: true }).click();
    await expect(page.locator('.status-badge')).toContainText('CLOSED');
    await kitchen.goto(`/seller/restaurants/${merchantId}/finance`);
    await expect(
      kitchen.getByRole('heading', { name: 'Restaurant financial records', exact: true }),
    ).toBeVisible();
    await expect(kitchen.getByText('Unreconciled', { exact: true })).toBeVisible();
    await admin.goto('/admin/reports');
    await expect(
      admin.getByRole('heading', { name: 'Marketplace reports', exact: true }),
    ).toBeVisible();
    await expect(admin.locator('.operations-metrics')).toContainText('DELIVERED');
    await audit(admin, 'admin-reports');
    const customerAccount = await auth
      .collection('users')
      .findOne({ contact: `${prefix}-customer@example.test` });
    await admin.goto('/admin/users/' + customerAccount!._id);
    await expect(
      admin.getByRole('heading', { name: 'Account details', exact: true }),
    ).toBeVisible();
    await expect(admin.getByText(`${prefix}-customer@example.test`, { exact: true })).toBeVisible();
    await admin.goto('/admin/riders');
    await expect(admin.getByRole('combobox', { name: 'Partner type', exact: true })).toHaveValue(
      'rider',
    );
    await admin.goto(`/admin/restaurants/${merchantId}`);
    await expect(
      admin.getByRole('heading', { name: 'Restaurant launch approval', exact: true }),
    ).toBeVisible();
    await admin.getByRole('button', { name: `Review ${prefix} Kitchen`, exact: true }).click();
    await admin
      .getByLabel('Launch review reason', { exact: true })
      .fill('Hosted-ready browser fixture merchant review');
    await admin
      .getByRole('checkbox', {
        name: 'I reviewed the restaurant and approve this change.',
        exact: true,
      })
      .check();
    await admin.getByRole('button', { name: 'Confirm launch approval', exact: true }).click();
    const merchantReview = admin
      .locator('article')
      .filter({ has: admin.getByRole('heading', { name: `${prefix} Kitchen`, exact: true }) });
    await expect(merchantReview).toContainText('Approved for live ordering');
    await audit(admin, 'admin-merchant-launch');
    await admin.screenshot({
      path: `.local/qa/merchant-launch-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await admin.getByRole('button', { name: `Review ${prefix} Kitchen`, exact: true }).click();
    await admin
      .getByLabel('Launch review reason', { exact: true })
      .fill('Revoke fixture launch after verified approval rehearsal');
    await admin
      .getByRole('checkbox', {
        name: 'I reviewed the restaurant and approve this change.',
        exact: true,
      })
      .check();
    await admin.getByRole('button', { name: 'Confirm launch revocation', exact: true }).click();
    await expect(merchantReview).toContainText('Awaiting launch review');
    await admin.goto('/admin/audit');
    await expect(admin.getByText('support.state', { exact: true }).first()).toBeVisible();
    for (const actor of [page, kitchen, admin])
      expect(
        await actor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    await page.screenshot({
      path: `.local/qa/support-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await kitchen.screenshot({
      path: `.local/qa/statement-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await kitchen.goto(`/seller/restaurants/${merchantId}/menu/new`);
    await kitchen.getByLabel('Dish name', { exact: true }).fill('Assistant Plain Rice');
    await kitchen.getByLabel('Base price (₹)', { exact: true }).fill('80');
    await kitchen.getByRole('button', { name: 'Save dish', exact: true }).click();
    await expect(kitchen.getByRole('table')).toContainText('Assistant Plain Rice');
    await page.goto(`/assistant?orderId=${paidOrderId}`);
    const assistantMessage = page.getByLabel('Your message', { exact: true });
    await assistantMessage.fill('Where is my order?');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.assistant-answer').last()).toContainText('DELIVERED', {
      timeout: 20000,
    });
    await expect(page).toHaveURL(/conversation=/);
    await page.reload();
    await expect(page.locator('.assistant-answer').last()).toContainText('DELIVERED');
    await assistantMessage.fill('Is this safe for my peanut allergy?');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.assistant-answer').last()).toContainText('cannot verify');
    await assistantMessage.fill('Find rice');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.assistant-dishes')).toContainText('Assistant Plain Rice');
    await page.getByRole('button', { name: 'Review cart addition', exact: true }).click();
    await expect(page.locator('.assistant-proposal')).toContainText('Assistant Plain Rice');
    await page.getByRole('button', { name: 'Confirm cart change', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open updated cart', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Prepare support handoff', exact: true }).click();
    const summary = page.getByRole('dialog', { name: 'Review your support summary', exact: true });
    await summary
      .getByLabel('Support subject', { exact: true })
      .fill('Assistant handoff ' + testInfo.project.name + ' ' + prefix);
    await summary
      .getByLabel('Summary to share', { exact: true })
      .fill('Please help me review my delivered order receipt.');
    await summary.getByRole('checkbox').check();
    await summary.getByRole('button', { name: 'Review ticket proposal', exact: true }).click();
    await expect(summary).not.toBeVisible();
    await page.getByRole('button', { name: 'Confirm support ticket', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Open support ticket', exact: true }),
    ).toBeVisible();
    await audit(page, 'customer-assistant');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.local/qa/assistant-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('link', { name: 'Open updated cart', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Assistant Plain Rice', exact: true }),
    ).toBeVisible();
    await admin.goto('/admin/assistant');
    await admin
      .getByLabel('Evaluation reason', { exact: true })
      .fill('Verify deployed synthetic assistant routing in browser fixture');
    await admin.getByRole('button', { name: 'Run routing evaluation', exact: true }).click();
    await expect(
      admin.getByRole('heading', { name: /routing cases passed/ }).first(),
    ).toBeVisible();
    await admin.screenshot({
      path: `.local/qa/assistant-admin-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.goto('/settings/privacy');
    await expect(
      page.getByRole('heading', { name: 'Privacy requests', exact: true }),
    ).toBeVisible();
    const workspaceMenu = page.getByRole('button', { name: 'Workspace menu', exact: true });
    const workspaceNavigation = page.getByRole('navigation', { name: 'Workspace navigation' });
    if (testInfo.project.name === 'mobile') {
      await expect(workspaceNavigation).not.toBeVisible();
      await workspaceMenu.focus();
      await page.keyboard.press('Enter');
      await expect(workspaceMenu).toHaveAttribute('aria-expanded', 'true');
      await expect(
        workspaceNavigation.getByRole('link', { name: 'Privacy requests', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await workspaceNavigation
        .getByRole('link', { name: 'Privacy requests', exact: true })
        .click();
      await expect(workspaceMenu).toHaveAttribute('aria-expanded', 'false');
    } else {
      await expect(workspaceNavigation).toBeVisible();
    }
    const consentBounds = await page.locator('.privacy-request-form .check-label').boundingBox();
    const submitBounds = await page
      .getByRole('button', { name: 'Submit privacy request', exact: true })
      .boundingBox();
    expect(
      consentBounds && submitBounds && submitBounds.y >= consentBounds.y + consentBounds.height,
    ).toBe(true);
    await audit(page, 'customer-privacy');
    await page.screenshot({
      path: `.local/qa/privacy-${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page
      .getByRole('checkbox', {
        name: 'I confirm this request concerns my own account.',
        exact: true,
      })
      .check();
    await page.getByRole('button', { name: 'Submit privacy request', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Personal data export request', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Personal data export request', exact: true }),
    ).toBeVisible();
    await page.goto('/settings/privacy');
    await page.getByLabel('Request type', { exact: true }).selectOption('delete');
    await page
      .getByRole('checkbox', {
        name: 'I confirm this request concerns my own account.',
        exact: true,
      })
      .check();
    await page.getByRole('button', { name: 'Submit privacy request', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Account deletion request', exact: true }),
    ).toBeVisible();
    await walkWorkspace(page, 'customer');
    await page.goto('/notifications');
    const unread = page
      .locator('.workspace-panel')
      .filter({ has: page.getByRole('button', { name: 'Mark read', exact: true }) })
      .first();
    await expect(unread).toBeVisible();
    const notificationTitle = await unread.getByRole('link').innerText();
    await page.route('**/api/v1/notifications/read', (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'Notification update temporarily unavailable. Please retry.',
          },
        },
      }),
    );
    await unread.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Notification update temporarily unavailable. Please retry.',
    );
    await expect(unread.getByRole('button', { name: 'Mark read', exact: true })).toBeEnabled();
    await page.unroute('**/api/v1/notifications/read');
    const notification = page
      .locator('.workspace-panel')
      .filter({ has: page.getByRole('link', { name: notificationTitle, exact: true }) });
    await notification.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(notification.getByRole('button', { name: 'Mark read', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    await walkWorkspace(kitchen, 'restaurant');
    await walkWorkspace(driver, 'rider');
    await page.goto('/profile');
    await page
      .getByLabel('New email or Indian mobile number', { exact: true })
      .fill(`${prefix}-correctable@example.test`);
    await page.getByRole('button', { name: 'Request verification code', exact: true }).click();
    await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use a different contact', exact: true }).click();
    await expect(page.getByLabel('New email or Indian mobile number', { exact: true })).toHaveValue(
      `${prefix}-correctable@example.test`,
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    // Default policy requires two distinct finance accounts, even for this small test adjustment.
    await admin.goto(`/admin/orders/${paidOrderId}`);
    await admin.getByLabel('Refund amount in rupees', { exact: true }).fill('1');
    await admin
      .getByLabel('Refund reason', { exact: true })
      .fill('Browser discretionary refund review fixture');
    await admin.getByRole('button', { name: 'Request refund authorization', exact: true }).click();
    await expect(admin.getByText('Refund request saved.', { exact: false })).toBeVisible();
    expect(
      await mongo
        .db(`${dbPrefix}_restaurant`)
        .collection('refund_intents')
        .countDocuments({ orderId: paidOrderId }),
    ).toBe(0);
    const pendingApproval = (
      await (await admin.request.get('/api/v1/admin/finance/approvals')).json()
    ).data.approvals.find(
      (value: { orderId: string; status: string }) =>
        value.orderId === paidOrderId && value.status === 'PENDING',
    );
    expect(pendingApproval).toBeTruthy();
    await admin.goto('/admin/finance');
    await expect(
      admin.getByText('Another finance account must review your request.', { exact: true }),
    ).toBeVisible();
    const reviewerId = randomUUID(),
      reviewerContact = `${prefix}-finance-reviewer@example.test`;
    await auth.collection('users').insertOne({
      _id: reviewerId as never,
      contact: reviewerContact,
      name: 'Independent Browser Finance Reviewer',
      roles: ['customer', 'admin'],
      permissions: adminPermissions,
      status: 'ACTIVE',
      createdAt: new Date(),
    });
    const reviewerContext = await browser.newContext({ viewport: page.viewportSize()! });
    contexts.push(reviewerContext);
    const reviewer = await reviewerContext.newPage();
    await signIn(reviewer, '/admin/login', reviewerContact);
    await expect(reviewer.getByAltText('Authenticator enrollment QR code')).toBeVisible();
    const reviewerSecret = await reviewer.getByTestId('totp-secret').textContent();
    await reviewer.locator('#auth-code').fill(totp(reviewerSecret!.trim()));
    await reviewer.getByRole('button', { name: 'Verify and continue' }).click();
    await reviewer.getByRole('button', { name: 'I’ve saved my recovery codes' }).click();
    await expect(reviewer.getByRole('heading', { name: 'Verification overview' })).toBeVisible();
    await reviewer.goto('/admin/finance');
    await reviewer
      .getByRole('button', {
        name: `Review request for ${pendingApproval.orderNumber}`,
        exact: true,
      })
      .click();
    await reviewer
      .getByLabel('Financial review reason', { exact: true })
      .fill('Independent reviewer confirmed fixture adjustment');
    await reviewer.getByRole('button', { name: 'Approve refund request', exact: true }).click();
    await expect(reviewer.getByText('Second approval recorded.', { exact: false })).toBeVisible();
    const authorized = (
      await (await reviewer.request.get('/api/v1/admin/finance/approvals')).json()
    ).data.approvals.find((value: { id: string }) => value.id === pendingApproval.id);
    expect(authorized.status).toBe('AUTHORIZED');
    expect(authorized.requestedBy).toBe(adminId);
    expect(authorized.reviewedBy).toBe(reviewerId);
    await audit(reviewer, 'financial-approval-review');
    await reviewer.screenshot({
      path: `.local/qa/financial-approval-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await reviewer.goto(`/admin/orders/${paidOrderId}`);
    await expect(reviewer.locator('.commerce-status')).toContainText('PARTIALLY REFUNDED', {
      timeout: 15000,
    });
    // Publish fixture text through two real MFA accounts, then read its immutable public version.
    await admin.goto('/admin/settings');
    await admin.getByLabel('Policy to manage', { exact: true }).selectOption('privacy');
    await admin.getByLabel('Policy title', { exact: true }).fill('Browser fixture privacy notice');
    await admin.getByLabel('Legal business name', { exact: true }).fill('Browser fixture business');
    await admin
      .getByLabel('Registered business address', { exact: true })
      .fill('Fixture registered office, Chennai, India');
    await admin.getByLabel('Support email', { exact: true }).fill('support@example.test');
    await admin
      .getByLabel('Grievance contact', { exact: true })
      .fill('Fixture officer at support@example.test');
    await admin
      .getByLabel('Policy text', { exact: true })
      .fill(
        'This labelled browser fixture verifies independently reviewed publication and safe plain text rendering. It is not a production legal policy. <script>window.policyFixture = true</script>',
      );
    await admin
      .getByLabel('Policy change or review reason', { exact: true })
      .fill('Prepare browser policy fixture for independent review');
    const [savedPolicy] = await Promise.all([
      admin.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/admin/settings/policies/privacy') &&
          response.request().method() === 'PUT',
      ),
      admin.getByRole('button', { name: 'Save policy draft', exact: true }).click(),
    ]);
    expect(savedPolicy.status()).toBe(200);
    await expect(
      admin.getByRole('button', { name: 'Publish reviewed draft', exact: true }),
    ).toBeDisabled();
    await reviewer.goto('/admin/settings');
    await reviewer.getByLabel('Policy to manage', { exact: true }).selectOption('privacy');
    await reviewer
      .getByLabel('Policy change or review reason', { exact: true })
      .fill('Independent browser fixture policy review');
    const [publishedPolicy] = await Promise.all([
      reviewer.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/admin/settings/policies/privacy/publish') &&
          response.request().method() === 'POST',
      ),
      reviewer.getByRole('button', { name: 'Publish reviewed draft', exact: true }).click(),
    ]);
    expect(publishedPolicy.status()).toBe(200);
    await expect(
      reviewer.getByRole('link', { name: 'View published policy', exact: true }),
    ).toBeVisible();
    await audit(reviewer, 'policy-settings');
    const revision = await reviewer
      .getByRole('link', { name: 'View published policy', exact: true })
      .getAttribute('href');
    await page.goto(revision!);
    await expect(
      page.getByRole('heading', { name: 'Browser fixture privacy notice', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('<script>window.policyFixture = true</script>', { exact: false }),
    ).toBeVisible();
    expect(await page.evaluate(() => Object.hasOwn(window, 'policyFixture'))).toBe(false);
    await audit(page, 'published-policy');
    const account = await auth
      .collection('users')
      .findOne({ contact: `${prefix}-customer@example.test` });
    expect(account).toBeTruthy();
    const privacyExport = await auth
      .collection('privacy_requests')
      .findOne({ userId: String(account!._id), kind: 'export' });
    expect(privacyExport).toBeTruthy();
    await reviewer.goto('/admin/privacy');
    const privacyCard = reviewer.getByTestId('privacy-review-' + String(privacyExport!._id));
    await privacyCard.getByRole('button', { name: 'Review privacy request', exact: true }).click();
    await reviewer
      .getByLabel('Privacy review reason', { exact: true })
      .fill('Verified browser fixture identity and account data scope');
    await reviewer.getByRole('button', { name: 'Approve privacy request', exact: true }).click();
    await expect(privacyCard).toContainText('PROCESSING');
    await audit(reviewer, 'privacy-admin-review');
    await walkWorkspace(reviewer, 'admin');
    expect(browserErrors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    const users = await auth
      .collection('users')
      .find({ contact: { $regex: `^${prefix}-` } })
      .toArray();
    const ids = users.map((user) => String(user._id));
    const applicationIds: string[] = [];
    for (const owner of ['restaurant', 'rider']) {
      const collection = mongo.db(`${dbPrefix}_${owner}`).collection('applications');
      const applications = await collection.find({ userId: { $in: ids } }).toArray();
      applicationIds.push(...applications.map((app) => String(app._id)));
      await collection.deleteMany({ userId: { $in: ids } });
    }
    const uploads = mongo.db(`${dbPrefix}_utils`).collection('uploads');
    for (const file of await uploads.find({ userId: { $in: ids } }).toArray()) {
      if (/^[0-9a-f-]{36}$/.test(String(file._id)))
        await unlink(resolve(process.env.BROWSER_UPLOAD_DIRECTORY!, `${file._id}.encrypted`)).catch(
          () => {},
        );
    }
    await uploads.deleteMany({ userId: { $in: ids } });
    const commerce = mongo.db(`${dbPrefix}_restaurant`);
    for (const name of ['restaurants', 'favorites'])
      await commerce.collection(name).deleteMany({ userId: { $in: ids } });
    const testOrders = await commerce
      .collection('orders')
      .find({ userId: { $in: ids } })
      .toArray();
    const orderIds = testOrders.map((order) => String(order._id));
    const utils = mongo.db(`${dbPrefix}_utils`);
    for (const name of ['payment_attempts', 'captures', 'refunds'])
      await utils.collection(name).deleteMany({ userId: { $in: ids } });
    await utils.collection('ledger').deleteMany({ orderId: { $in: orderIds } });
    await utils.collection('outbox').deleteMany({ 'event.data.orderId': { $in: orderIds } });
    for (const name of ['orders', 'quotes', 'refund_intents'])
      await commerce.collection(name).deleteMany({ userId: { $in: ids } });
    await commerce.collection('financial_approvals').deleteMany({ orderId: { $in: orderIds } });
    await commerce.collection('outbox').deleteMany({ 'event.data.orderId': { $in: orderIds } });
    await commerce.collection('carts').deleteMany({ _id: { $in: ids } as never });
    for (const name of ['menu_items', 'offers'])
      await commerce.collection(name).deleteMany({ restaurantId: { $in: applicationIds } });
    await auth.collection('addresses').deleteMany({ userId: { $in: ids } });
    await mongo
      .db(`${dbPrefix}_admin`)
      .collection('zones')
      .deleteMany({ _id: { $in: zoneIds } as never });
    for (const owner of ['auth', 'restaurant'])
      await mongo
        .db(`${dbPrefix}_${owner}`)
        .collection('outbox')
        .deleteMany({ 'event.aggregate.id': { $in: [...ids, ...applicationIds] } });

    for (const name of ['sessions', 'refresh_tokens', 'mfa_challenges'])
      await auth.collection(name).deleteMany({ userId: { $in: ids } });
    await auth.collection('users').deleteMany({ contact: { $regex: `^${prefix}-` } });
    const admin = mongo.db(`${dbPrefix}_admin`);
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
