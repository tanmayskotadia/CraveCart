import { startService } from '@cravecart/platform';
import { installApplications } from './applications.js';

import { installDeliveries } from './deliveries.js';
import { installRiderOperations } from './operations.js';
await startService('rider', (app, ctx) => {
  installApplications(app, ctx);
  installDeliveries(app, ctx);
  installRiderOperations(app, ctx);
});
