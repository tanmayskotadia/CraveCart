import { startService } from '@cravecart/platform';
import { installAuth } from './router.js';
import { installAddresses } from './addresses.js';

await startService('auth', (app, ctx) => {
  installAuth(app, ctx);
  installAddresses(app, ctx);
});
