import { startService } from '@cravecart/platform';
import { installApplications } from './applications.js';

await startService('rider', installApplications);
