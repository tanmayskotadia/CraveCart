import { startService } from '@cravecart/platform';
import { installUploads } from './uploads.js';
import { installPayments } from './payments.js';
import { installAssistant } from './assistant.js';

await startService('utils', (app, ctx) => {
  installUploads(app, ctx);
  installPayments(app, ctx);
  installAssistant(app, ctx);
});
