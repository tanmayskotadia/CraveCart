import { startService } from '@cravecart/platform';
import { installVerifications } from './verifications.js';

await startService('admin', installVerifications);
