import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { adminPermissions } from '../../services/auth/src/router.js';
import { totp } from '../../services/auth/src/totp.js';

test('real accounts, documents, MFA and both partner approvals', async ({ page, browser }) => {
  const prefix = `browser-${randomUUID()}`;
  const adminContact = `${prefix}-admin@example.test`;
  const adminId = randomUUID();
  const mongo = new MongoClient(process.env.IDENTITY_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0');
  await mongo.connect();
  const auth = mongo.db('cravecart_auth');
  // Synthetic test-only verifier, isolated by UUID; never a public/default admin.
  await auth.collection('users').insertOne({ _id:adminId as never, contact: adminContact, name:'Browser Verifier',roles:['customer','admin'],permissions:adminPermissions,status:'ACTIVE',createdAt:new Date() });
  const contexts = [];
  async function signIn(target:Page,path:string,email:string,signup=false) {
    await target.goto(path);
    const dialog=target.getByRole('dialog');
    await dialog.getByRole('button',{name:'Continue with email',exact:true}).click();
    if(signup)await dialog.getByLabel('Full name').fill('Browser Partner');
    await dialog.getByLabel('Email address').fill(email);
    await dialog.getByRole('button',{name:'Continue with email',exact:true}).click();
    const banner=dialog.getByTestId('development-code');
    await expect(banner).toBeVisible();
    expect(await banner.textContent()).toContain('No SMS or email');
    await dialog.locator('#auth-code').fill((await banner.locator('strong').innerText()).trim());
    await dialog.getByRole('button',{name:'Verify and continue'}).click();
  }
  try {
    await signIn(page,'/signup',`${prefix}-customer@example.test`,true);
    await expect(page).toHaveURL(/\/profile$/);
    await page.reload();
    await expect(page.getByRole('heading',{level:1})).toContainText('Your account');
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading',{name:'This workspace isn’t available to you.'})).toBeVisible();

    const adminContext=await browser.newContext({viewport:page.viewportSize()!});contexts.push(adminContext);
    const admin=await adminContext.newPage();
    await signIn(admin,'/admin/login',adminContact);
    await expect(admin.getByAltText('Authenticator enrollment QR code')).toBeVisible();
    const secret=await admin.getByTestId('totp-secret').textContent();
    await admin.locator('#auth-code').fill(totp(secret!.trim()));
    await admin.getByRole('button',{name:'Verify and continue'}).click();
    await expect(admin.getByRole('heading',{name:'Save your recovery codes'})).toBeVisible();
    await admin.getByRole('button',{name:'I’ve saved my recovery codes'}).click();
    await expect(admin.getByRole('heading',{name:'Verification overview'})).toBeVisible();

    const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#ffffff'}}).png().toBuffer();
    for(const kind of ['seller','rider'] as const) {
      const context=await browser.newContext({viewport:page.viewportSize()!});contexts.push(context);
      const partner=await context.newPage();
      await signIn(partner,`/${kind}/register`,`${prefix}-${kind}@example.test`,true);
      await expect(partner).toHaveURL(new RegExp(`/${kind}/onboarding$`));
      await partner.getByLabel('City',{exact:true}).selectOption('chennai');
      await partner.getByLabel('PIN code').fill('600001');
      if(kind==='seller')await partner.getByLabel('Restaurant or business name').fill(`${prefix} Kitchen`);
      await partner.getByLabel(kind==='seller'?'Business address':'Address',{exact:true}).fill('123 Test Street, Chennai');
      await partner.getByLabel('Verification document',{exact:true}).setInputFiles({name:'verification.png',mimeType:'image/png',buffer:bytes});
      await expect(partner.getByText('Development checked',{exact:true})).toBeVisible();
      await partner.getByRole('button',{name:'Submit for verification'}).click();
      await expect(partner.getByRole('heading',{name:'Your application is with our verification team.'})).toBeVisible();
      const me=await partner.request.get('/api/v1/auth/me');
      const user=(await me.json()).data.principal;
      const app=await mongo.db(kind==='seller'?'cravecart_restaurant':'cravecart_rider').collection('applications').findOne({userId:user.userId});
      expect(app).toBeTruthy();
      await admin.goto(`/admin/verifications/${app!._id}`);
      await admin.getByRole('button',{name:'View document 1'}).click();
      await expect(admin.getByRole('dialog',{name:'Verification document'})).toBeVisible();
      await admin.getByRole('button',{name:'Close dialog'}).click();
      await admin.getByLabel('Reason, visible to the applicant').fill('Browser verification reviewed and approved');
      await admin.getByRole('button',{name:'Confirm decision'}).click();
      await expect(admin.getByRole('heading',{name:'Review operation: applied'})).toBeVisible();
      await partner.reload();
      await expect(partner.getByRole('link',{name:'Open your workspace'})).toBeVisible();
      await partner.getByRole('link',{name:'Open your workspace'}).click();
      await expect(partner.getByRole('heading',{level:1})).toContainText(kind==='seller'?'Your restaurants':'Delivery partner workspace');
      expect(await partner.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    }
    await page.goto('/profile');
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.goto('/profile');
    await expect(page.getByRole('heading',{name:'Sign in to continue'})).toBeVisible();
  } finally {
    for(const context of contexts)await context.close();
    const users=await auth.collection('users').find({contact:{$regex:`^${prefix}-`}}).toArray();
    const ids=users.map(user=>String(user._id));
    const applicationIds:string[]=[];
    for(const owner of ['restaurant','rider']) {
      const collection=mongo.db(`cravecart_${owner}`).collection('applications');
      const applications=await collection.find({userId:{$in:ids}}).toArray();
      applicationIds.push(...applications.map(app=>String(app._id)));
      await collection.deleteMany({userId:{$in:ids}});
    }
    const uploads=mongo.db('cravecart_utils').collection('uploads');
    for(const file of await uploads.find({userId:{$in:ids}}).toArray()) {
      if(/^[0-9a-f-]{36}$/.test(String(file._id)))await unlink(resolve('.local/uploads',`${file._id}.encrypted`)).catch(()=>{});
    }
    await uploads.deleteMany({userId:{$in:ids}});
    for(const name of ['sessions','refresh_tokens','mfa_challenges'])await auth.collection(name).deleteMany({userId:{$in:ids}});
    await auth.collection('users').deleteMany({contact:{$regex:`^${prefix}-`}});
    const admin=mongo.db('cravecart_admin');
    for(const name of ['verification_cases','verification_operations'])await admin.collection(name).deleteMany(name==='verification_cases'?{_id:{$in:applicationIds} as never}:{applicationId:{$in:applicationIds}});
    await admin.collection('audit').deleteMany({$or:[{actorId:{$in:ids}},{applicationId:{$in:applicationIds}}]});
    await mongo.close();
  }
});
