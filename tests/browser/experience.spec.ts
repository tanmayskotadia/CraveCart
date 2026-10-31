import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

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
test('filters preserve the dish search and recover from an empty page', async ({ page }) => {
  await page.goto('/search?city=chennai&q=Biryani&diet=veg&maxMinutes=20&page=9');
  await expect(
    page.getByRole('heading', { name: 'No restaurants match this view.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Return to first page' }).click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(page).toHaveURL(/diet=veg/);
  await page.getByRole('button', { name: 'Remove Vegetarian', exact: true }).click();
  await expect(page).not.toHaveURL(/diet=/);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL(/city=chennai&q=Biryani$/);
  await page.getByRole('button', { name: 'Adjust filters', exact: true }).click();
  await expect(page.getByLabel('Dietary preference', { exact: true })).toBeVisible();
  await page.getByLabel('Dietary preference', { exact: true }).selectOption('vegan');
  await expect(page.getByRole('button', { name: 'Remove Vegan', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Clear dish search' }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page).toHaveURL(/diet=vegan/);
});

test('header city selection keeps the current search and clear text restores focus', async ({
  page,
}) => {
  await page.goto('/search?city=chennai&q=Biryani');
  await page
    .getByRole('button', { name: 'Change browsing city, currently Chennai', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill('Kochi');
  await dialog.getByRole('button', { name: 'Kochi Kerala' }).click();
  await expect(page).toHaveURL(/city=kochi&q=Biryani/);
  await page.getByRole('button', { name: 'Clear search text', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search for a dish or cuisine' });
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: 'Explore food', exact: true }).click();
  await expect(page).not.toHaveURL(/q=/);
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

test('customer login keeps Home and refresh in discovery until explicit logout', async ({
  page,
}) => {
  let signedIn = false;
  const session = {
    principal: {
      userId: '88c27ad9-c409-4cee-a767-98037a4ee341',
      sessionId: 'a0bbb917-72b6-4be6-80d7-31818a1abc59',
      name: 'Local Customer',
      contact: '9876543210',
      roles: ['customer'],
      permissions: [],
      workspace: 'customer',
      mfaEnabled: false,
      mfaVerifiedAt: null,
      authenticatedAt: new Date().toISOString(),
    },
    csrfToken: 'browser-session-fixture-csrf-token-1234567890',
    accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  await page.route('**/api/v1/auth/me', async (route) => {
    // A slow session lookup must not flash the marketing landing page after refresh.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill(
      signedIn
        ? { json: { data: session } }
        : {
            status: 401,
            json: { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
          },
    );
  });
  await page.route('**/api/v1/auth/otp/verify', (route) => {
    signedIn = true;
    return route.fulfill({ json: { data: session } });
  });
  await page.route('**/api/v1/auth/logout', (route) => {
    signedIn = false;
    return route.fulfill({ json: { data: { success: true } } });
  });
  await page.goto('/search?city=chennai');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Log in', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Log in');
  await dialog.getByLabel('Mobile number', { exact: true }).fill('9876543210');
  await dialog.getByRole('button', { name: 'Send one-time password' }).click();
  await dialog.getByLabel('Verification code', { exact: true }).fill('123456');
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/search\?city=chennai$/);
  await page.getByRole('link', { name: 'CraveCart home', exact: true }).click();
  await expect(page).toHaveURL(/\/search\?city=chennai$/);
  await page.goto('/');
  await expect(page.locator('.hero')).toHaveCount(0);
  await expect(page).toHaveURL(/\/search\?city=chennai$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Chennai.');
  await page.goto('/login');
  await expect(page).toHaveURL(/\/search\?city=chennai$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every corner of India.');
});

for (const [label, path, title] of [
  ['Customer', '/login', 'Log in'],
  ['Restaurant', '/seller/login', 'Restaurant partner login'],
  ['Delivery partner', '/rider/login', 'Delivery partner login'],
  ['Administration', '/admin/login', 'Admin login'],
]) {
  test(`workspace access connects ${label} sign-in without public admin registration`, async ({
    page,
  }) => {
    await page.goto('/access');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'A place for every appetite.',
    );
    await expect(page.locator('.access-card')).toHaveCount(4);
    await expect(
      page.getByRole('link', { name: /admin.*(register|create)|register.*admin/i }),
    ).toHaveCount(0);
    await page
      .getByRole('main')
      .getByRole('link', { name: `${label} login`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName(title!);
    if (label === 'Customer') {
      await expect(dialog.getByRole('link', { name: 'Choose a different workspace' })).toHaveCount(
        0,
      );
      await expect(
        page
          .getByRole('navigation', { name: 'Main navigation' })
          .getByRole('link', { name: /restaurant|partner|workspace/i }),
      ).toHaveCount(0);
      await page.goto('/access');
    } else {
      await dialog.getByRole('link', { name: 'Choose a different workspace' }).click();
    }
    await expect(page).toHaveURL(/\/access$/);
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
test('footer admin login accepts private credentials and still requires an authenticator', async ({
  page,
}, testInfo) => {
  const loginId = `synthetic-admin-${testInfo.project.name}@example.test`;
  const password = `synthetic-${Date.now()}-${testInfo.project.name}-password`;
  await page.route('**/api/v1/auth/capabilities', (route) =>
    route.fulfill({
      json: {
        data: {
          methods: ['phone', 'email'],
          developmentDelivery: true,
          adminPasswordEnabled: true,
        },
      },
    }),
  );
  await page.route('**/api/v1/auth/admin/password', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.loginId).toBe(loginId);
    await route.fulfill(
      body.password === password
        ? {
            json: {
              data: {
                mfaChallengeId: 'synthetic-admin-mfa-challenge-1234567890',
                enrollmentRequired: false,
              },
            },
          }
        : {
            status: 401,
            json: {
              error: {
                code: 'INVALID_ADMIN_CREDENTIALS',
                message: 'Admin login ID or password is incorrect',
              },
            },
          },
    );
  });
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'Admin login', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Admin login', exact: true });
  await dialog.getByLabel('Admin login ID', { exact: true }).fill(loginId);
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByLabel('Password', { exact: true }).fill('incorrect');
  await dialog.getByRole('button', { name: 'Sign in as admin', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('incorrect');
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Sign in as admin', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByLabel('Authenticator or recovery code', { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('dialog').getByLabel('Password', { exact: true })).toHaveCount(0);
});

test('workspace access has a responsive visual record', async ({ page }, testInfo) => {
  await page.goto('/access');
  await expect(page.locator('.access-card')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  await mkdir('.local/qa', { recursive: true });
  await page.screenshot({
    path: `.local/qa/workspace-access-${testInfo.project.name}.png`,
    fullPage: true,
  });
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
  await expect(page.getByRole('dialog', { name: 'Admin login' })).toBeVisible();
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
    '/access',
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
