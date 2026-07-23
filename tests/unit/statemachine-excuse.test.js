import { describe, it, expect } from 'vitest';
import { oracleExcuse } from '../../js/statemachine.js';

describe('oracleExcuse', () => {
  it('handles a missing key / no oracle', () => {
    expect(oracleExcuse('no oracle')).toContain('Settings');
    expect(oracleExcuse('no oracle')).toContain('dormant');
  });
  it('handles 401/403 as a refused key', () => {
    expect(oracleExcuse('http 401: bad key')).toContain('refused');
    expect(oracleExcuse('http 403: nope')).toContain('refused');
  });
  it('handles other http errors with the code', () => {
    expect(oracleExcuse('http 500: boom')).toContain('(http 500)');
  });
  it('handles network failure and timeout the same way', () => {
    expect(oracleExcuse('request failed: offline')).toContain('Wi-Fi');
    expect(oracleExcuse('timed out')).toContain('Wi-Fi');
  });
  it('handles empty reply and a generic fallback', () => {
    expect(oracleExcuse('empty reply')).toContain('said nothing');
    expect(oracleExcuse('the diary lost that page (show:9)')).toContain('ink blurred');
  });
});
