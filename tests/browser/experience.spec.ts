import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/restaurants?*', (route) =>
    route.fulfill({
      json: { data: { restaurants: [], total: 0, page: 1, pageSize: 12, orderingEnabled: false } },
    }),
  );
  for (const endpoint of ['me', 'csrf'])
    await page.route(`**/api/v1/auth/${endpoint}`, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }),
      }),
    );
  await page.route('**/api/v1/auth/capabilities', (route) =>
    route.fulfill({ json: { data: { methods: ['phone', 'email'], developmentDelivery: true } } }),
  );
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 202,
      json: {
        data: {
          challengeId: 'test-challenge-01234567890123456789012345',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          resendAfterSeconds: 45,
          delivery: 'development',
          developmentCode: '123456',
        },
      },
    }),
  );
  await page.route('**/api/v1/platform', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          name: 'CraveCart',
          market: { scope: 'national', country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' },
          capabilities: {
            ordering: false,
            authentication: false,
            liveTracking: false,
            assistant: false,
          },
          serviceability: 'not-configured',
        },
        meta: { requestId: '20d2826f-65f8-4f71-a4b5-97e1c2733f9a' },
      }),
    }),
  );
});
test('national photographic landing renders without horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every corner of India.');
  await expect(page.locator('.hero-picture img')).toBeVisible();
  expect(
    await page
      .locator('.hero-picture img')
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('city search changes location, survives reload, and never claims live delivery', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Select your city', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox', { name: 'Search cities' }).fill('Hyderabad');
  await dialog.getByRole('button', { name: 'Hyderabad Telangana' }).click();
  await expect(page).toHaveURL(/city=hyderabad/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Hyderabad.');
  await expect(page.locator('.service-notice')).toContainText('Choose a delivery address');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Change city, currently Hyderabad' }),
  ).toBeVisible();
});
test('dish search preserves the query through city selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search for a dish or cuisine' }).fill('Biryani');
  await page.getByRole('button', { name: 'Explore food' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill('Kochi');
  await dialog.getByRole('button', { name: 'Kochi Kerala' }).click();
  await expect(page).toHaveURL(/city=kochi&q=Biryani/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Biryani in Kochi');
});
test('login validates contacts and labels development delivery explicitly', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Log in', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Log in');
  await dialog.getByRole('button', { name: 'Send one-time password' }).click();
  await expect(dialog.getByRole('alert')).toContainText('10-digit');
  await dialog.getByRole('textbox', { name: 'Mobile number' }).fill('9876543210');
  await dialog.getByRole('button', { name: 'Send one-time password' }).click();
  await expect(dialog.getByTestId('development-code')).toContainText('No SMS or email');
  await dialog.getByRole('button', { name: 'Change contact' }).click();
  await dialog.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Email address' }).fill('food@example.com');
  await dialog.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await expect(dialog.getByTestId('development-code')).toContainText('No SMS or email');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});
test('signup and modal deep-link refresh work', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('dialog').getByRole('link', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog', { name: 'Create account' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Create account' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every craving.');
});
test('verification and recovery links use the implemented passwordless login', async ({ page }) => {
  for (const path of ['/verify', '/forgot-password', '/reset-password']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('dialog', { name: 'Log in', exact: true })).toBeVisible();
  }
});
test('city expansion, empty search and phone preview work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.city-card')).toHaveCount(9);
  await page.getByRole('button', { name: 'See all cities' }).click();
  await expect(page.locator('.city-card')).toHaveCount(18);
  await page.locator('.dish-toggle').getByRole('button', { name: 'Pizza', exact: true }).click();
  await expect(page.getByAltText('Pizza discovery preview')).toBeVisible();
  await page.getByRole('button', { name: 'Find your city', exact: true }).click();
  await page.getByRole('dialog').getByRole('searchbox').fill('NoSuchCity');
  await expect(
    page.getByRole('dialog').getByText('No city matches', { exact: false }),
  ).toBeVisible();
});
test('protected deep links and driver aliases cannot reveal private content', async ({ page }) => {
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to admin access' }).click();
  await expect(page.getByRole('dialog', { name: 'Team login' })).toBeVisible();
  await page.goto('/driver/deliveries/delivery_001');
  await expect(page).toHaveURL(/\/rider\/deliveries\/delivery_001$/);
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
});
test('unknown city and unknown routes recover safely with keyboard navigation', async ({
  page,
}) => {
  await page.goto('/search?city=made-up');
  await expect(page.getByRole('heading', { name: 'Let’s find your city.' })).toBeVisible();
  await page.goto('/not-a-real-route');
  await expect(page.getByRole('heading', { name: 'We couldn’t find that page' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});
test('availability outages retain city browsing and allow retry', async ({ page }) => {
  await page.route('**/api/v1/platform', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('.availability-note')).toContainText('still explore cities');
});
test('reduced motion disables decorative animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(
    await page
      .locator('.hero-picture img')
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  await expect(page.locator('.story-copy h2')).toBeVisible();
});

test('public discovery and authentication have no WCAG A/AA automated violations', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of [
    '/',
    '/search?city=chennai',
    '/login',
    '/signup',
    '/seller/login',
    '/rider/login',
    '/admin/login',
  ]) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const name = `accessibility-${path.replaceAll(/[^a-z0-9]/gi, '_')}`;
    const evidencePath = testInfo.outputPath(`${name}.json`);
    await writeFile(evidencePath, JSON.stringify(results, null, 2));
    await testInfo.attach(name, {
      path: evidencePath,
      contentType: 'application/json',
    });
    expect
      .soft(
        results.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      )
      .toEqual([]);
  }
});
