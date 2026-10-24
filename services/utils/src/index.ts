import { startService } from '@cravecart/platform';
import { installUploads } from './uploads.js';
import { installPayments } from './payments.js';

await startService('utils', (app, ctx) => {
  installUploads(app, ctx);
  installPayments(app, ctx);
});
