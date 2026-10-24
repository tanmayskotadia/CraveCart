import { startService } from '@cravecart/platform';
import { installApplications } from './applications.js';
import { installCatalog } from './catalog.js';

await startService('restaurant', (app, ctx) => {
  installCatalog(app, ctx);
  installApplications(app, ctx);
});
