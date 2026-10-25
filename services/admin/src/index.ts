import { startService } from '@cravecart/platform';
import { installVerifications } from './verifications.js';
import { installZones } from './zones.js';
import { installDeliveryOperations } from './delivery-operations.js';
import { installFinance } from './finance.js';
import { installSupport } from './support.js';
import { installAssistantAdmin } from './assistant.js';
import { installAdminOperations } from './operations.js';

await startService('admin', (app, ctx) => {
  installVerifications(app, ctx);
  installZones(app, ctx);
  installFinance(app, ctx);
  installDeliveryOperations(app, ctx);
  installSupport(app, ctx);
  installAssistantAdmin(app,ctx);
  installAdminOperations(app, ctx);
});
