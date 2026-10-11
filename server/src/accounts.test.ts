import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from './app';
import { config } from './config';
import { openDb } from './db';
import { RenderQueue } from './queue/renderQueue';

// The server makes phone-app accounts itself (already confirmed), so Supabase sends no email.
const made: { email: string }[] = [];
vi.mock('./supabase', () => ({
  createAccount: async (a: { email: string }) => {
    if (a.email === 'taken@example.com') throw new Error('A user with this email address has already been registered');
    made.push(a);
  },
}));

describe('making phone-app accounts', () => {
  let app: App;
  const saved = { supabaseUrl: config.supabaseUrl, supabaseServiceKey: config.supabaseServiceKey };
  const account = { email: 'Jane@Example.com', password: 'secret1', firstName: 'Jane', lastName: 'Smith' };
  const post = (payload: object, phone = '203.0.113.20') =>
    app.inject({ method: 'POST', url: '/accounts', headers: { 'x-forwarded-for': phone }, payload });

  beforeAll(async () => {
    Object.assign(config, { supabaseUrl: 'https://example.supabase.co', supabaseServiceKey: 'service' });
    const db = openDb(':memory:');
    app = await buildApp({ db, queue: new RenderQueue(db), logger: false });
  });
  afterAll(async () => {
    await app.close();
    Object.assign(config, saved);
  });

  it('makes an account with no confirmation email', async () => {
    const res = await post(account);
    expect(res.statusCode).toBe(201);
    expect(made.at(-1)).toMatchObject({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Smith' });
  });

  it('says so when the email already has an account', async () => {
    expect((await post({ ...account, email: 'taken@example.com' }, '203.0.113.21')).statusCode).toBe(409);
  });

  it('needs a name and a password of at least 6 characters', async () => {
    expect((await post({ ...account, password: '12345' }, '203.0.113.22')).statusCode).toBe(400);
    expect((await post({ ...account, firstName: ' ' }, '203.0.113.22')).statusCode).toBe(400);
  });

  it('limits how many accounts one phone can make in an hour', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post({ ...account, email: `p${i}@example.com` }, '203.0.113.23')).statusCode);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });
});
