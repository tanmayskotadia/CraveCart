import { startService } from '@cravecart/platform';
import { installRealtime } from './realtime.js';
import { installPush } from './push.js';
import { installMessaging } from './messaging.js';
await startService('realtime', (app, ctx) => {
  installRealtime(app, ctx);
  installPush(app, ctx);
  installMessaging(app, ctx);
});
