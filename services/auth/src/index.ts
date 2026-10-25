import { startService } from '@cravecart/platform';
import { installAuth } from './router.js';
import { installAssistantIdentity } from './assistant.js';
import { installAddresses } from './addresses.js';

await startService('auth', (app, ctx) => {
  installAuth(app, ctx);
  installAssistantIdentity(app, ctx);
  installAddresses(app, ctx);
  installGovernance(app, ctx);
});
import { installGovernance } from './governance.js';
