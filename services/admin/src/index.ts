import { startService } from '@cravecart/platform';
import { installVerifications } from './verifications.js';
import { installZones } from './zones.js';
import { installFinance } from './finance.js';

await startService('admin', (app, ctx) => {
  installVerifications(app, ctx);
  installZones(app, ctx);
  installFinance(app, ctx);
});
