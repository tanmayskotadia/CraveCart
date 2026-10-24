import { startService } from '@cravecart/platform';
import { installAuth } from './router.js';

await startService('auth', installAuth);
