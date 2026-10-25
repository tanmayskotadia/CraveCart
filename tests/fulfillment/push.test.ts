import { describe, it, expect } from 'vitest';
import { allowedPushEndpoint } from '../../services/realtime/src/push.js';
describe('push endpoint allowlist', () => {
  it('allows only known HTTPS browser push providers', () => {
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/token',
      'https://updates.push.services.mozilla.com/wpush/v2/token',
      'https://web.push.apple.com/token',
    ])
      expect(allowedPushEndpoint(url)).toBe(true);
  });
  it('blocks internal addresses, URL credentials, lookalike hosts and custom ports', () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/push',
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.test/x',
      'https://fcm.googleapis.com@127.0.0.1/x',
      'https://fcm.googleapis.com:444/x',
    ])
      expect(allowedPushEndpoint(url)).toBe(false);
  });
});
