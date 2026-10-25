import { startService } from '@cravecart/platform';
import { installApplications } from './applications.js';
import { installCatalog } from './catalog.js';
import { installAssistantTools } from './assistant.js';
import { installFulfillment } from './fulfillment.js';
import { installOrders } from './orders.js';
import { installRestaurantOperations } from './operations.js';

await startService('restaurant', (app, ctx) => {
  const catalog=installCatalog(app, ctx);
  installAssistantTools(app,ctx,catalog);
  installApplications(app, ctx);
  const orders = installOrders(app, ctx);
  installFulfillment(app, ctx, orders);
  installRestaurantOperations(app, ctx);
});
