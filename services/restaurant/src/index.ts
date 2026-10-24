import { startService } from '@cravecart/platform';
import { installApplications } from './applications.js';
import { installCatalog } from './catalog.js';
import { installOrders } from './orders.js';

await startService('restaurant', (app, ctx) => {
  installCatalog(app, ctx);
  installApplications(app, ctx);
  installOrders(app, ctx);
});
