import { describe, expect, it, vi } from 'vitest';
import { CloudWorker, retryAfterDailyLimit, type CloudJob, type JobStore } from './cloudWorker';

const job: CloudJob = { id: 'j1', kind: 'proposal', ref: 'p1', lease_token: 't1', attempts: 1 };
const store = (): JobStore => ({ claim: vi.fn().mockResolvedValue(job), renew: vi.fn().mockResolvedValue(true), finish: vi.fn().mockResolvedValue(true) });
describe('cloud worker', () => {
  it('finishes only after processing and records a recoverable failure', async () => {
    const s = store();
    const process = vi.fn().mockRejectedValue(new Error('Upload failed'));
    await new CloudWorker(s, process, () => {}).tick();
    expect(s.finish).toHaveBeenCalledWith(job, 'Upload failed', null);
    process.mockResolvedValue(undefined);
    await new CloudWorker(s, process, () => {}).tick();
    expect(s.finish).toHaveBeenLastCalledWith(job, null, null);
  });
  it('does not publish completion after the lease is lost', async () => {
    const s = store();
    vi.mocked(s.renew).mockResolvedValue(false);
    const process = async (_j: CloudJob, assertLease: () => void) => {
      await new Promise((r) => setTimeout(r, 30));
      assertLease();
    };
    await new CloudWorker(s, process, () => {}, 1, 5).tick();
    expect(s.finish).not.toHaveBeenCalled();
  });
  it('defers daily limits until UTC reset and does not defer unrelated failures', () => {
    expect(retryAfterDailyLimit('Daily limit reached', new Date('2026-10-11T23:59:59Z'))).toBe('2026-10-12T00:01:00.000Z');
    expect(retryAfterDailyLimit('Invalid op')).toBeNull();
  });
});
