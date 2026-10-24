import { startService } from '@cravecart/platform';
import { installUploads } from './uploads.js';

await startService('utils', installUploads);
