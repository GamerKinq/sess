require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const http = require('http');

const GUILD_ID = (process.env.GUILD_ID || '').trim();
const CHANNEL_ID = (process.env.CHANNEL_ID || '').trim();
const TOKENS = (process.env.TOKENS || '')
  .split(/[\n,;]+/)
  .map(t => t.trim())
  .filter(Boolean);

const SELF_DEAF = process.env.SELF_DEAF !== 'false';
const SELF_MUTE = process.env.SELF_MUTE !== 'false';

if (!GUILD_ID || !CHANNEL_ID || !TOKENS.length) {
  console.error('EKSIK AYAR -> GUILD_ID / CHANNEL_ID / TOKENS doldurulmali.');
  process.exit(1);
}

const log = (n, ...a) => console.log(new Date().toISOString(), `[${n}]`, ...a);

class Slot {
  constructor(token, idx) {
    this.name = `hesap${idx + 1}`;
    this.token = token;
    this.client = new Client({ checkUpdate: false });
    this.conn = null;
    this.busy = false;
    this.timer = null;
    this.watch = null;
    this.loginTimer = null;
    this.loggedIn = false;
  }

  scheduleRejoin(d = 4000) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.join();
    }, d);
  }

  async login() {
    if (this.loggedIn) return;
    try {
      await this.client.login(this.token);
      this.loggedIn = true;
    } catch (e) {
      log(this.name, 'LOGIN HATASI:', e.message, '-> 60s sonra tekrar');
      this.loginTimer = setTimeout(() => this.login(), 60000);
    }
  }

  async join() {
    if (this.busy || !this.client.user) return;
    this.busy = true;
    try {
      const g = this.client.guilds.cache.get(GUILD_ID)
        || await this.client.guilds.fetch(GUILD_ID).catch(() => null);
      if (!g) {
        log(this.name, 'sunucu bulunamadi, 15s sonra tekrar');
        return this.scheduleRejoin(15000);
      }

      const ch = g.channels.cache.get(CHANNEL_ID)
        || await g.channels.fetch(CHANNEL_ID).catch(() => null);
      if (!ch) {
        log(this.name, 'kanal bulunamadi, 15s sonra tekrar');
        return this.scheduleRejoin(15000);
      }

      if (g.me?.voice?.channelId === CHANNEL_ID) return;

      this.conn = this.client.voice.joinChannel(ch, {
        selfMute: SELF_MUTE,
        selfDeaf: SELF_DEAF,
        selfVideo: false
      });

      log(this.name, 'kanala girildi:', g.name, '/', ch.name);

      this.conn.on('stateChange', (_, next) => {
        const s = next?.status;
        if (s === 'disconnected' || s === 'reconnecting' || s === 'destroyed') {
          log(this.name, 'baglanti durumu:', s, '-> geri girilecek');
          this.scheduleRejoin();
        }
      });

      this.conn.on('error', e => log(this.name, 'voice hata:', e.message));
    } catch (e) {
      log(this.name, 'katilma hatasi:', e.message);
      this.scheduleRejoin(10000);
    } finally {
      this.busy = false;
    }
  }

  start() {
    const c = this.client;

    c.on('voiceStateUpdate', (_, next) => {
      if (next.id !== c.user?.id) return;
      if (next.channelId === CHANNEL_ID) return;
      log(this.name, 'sesten cikarildi ->', next.channelId ?? 'null');
      this.scheduleRejoin(2500);
    });

    c.on('ready', () => {
      log(this.name, 'giris yapildi:', c.user.username);
      this.join();
    });

    c.on('error', e => log(this.name, 'client hata:', e.message));
    c.on('shardError', e => log(this.name, 'shard hata:', e.message));

    this.login();

    this.watch = setInterval(() => {
      if (!c.user) return;
      if (c.user.voice?.channelId !== CHANNEL_ID) this.scheduleRejoin(2000);
    }, 45000);
  }

  status() {
    const id = this.client.user?.voice?.channelId;
    return {
      hesap: this.name,
      user: this.client.user?.username ?? null,
      durum: !this.client.user
        ? 'baglaniyor'
        : id === CHANNEL_ID
          ? 'seste'
          : 'seste degil'
    };
  }

  destroy() {
    clearInterval(this.watch);
    clearTimeout(this.timer);
    clearTimeout(this.loginTimer);
    try { this.conn?.disconnect?.(); } catch {}
    try { this.client.destroy(); } catch {}
  }
}

const slots = TOKENS.map((t, i) => new Slot(t, i));
log('global', `${slots.length} hesap baslatiliyor | sunucu: ${GUILD_ID} | kanal: ${CHANNEL_ID}`);
slots.forEach(s => s.start());

process.on('uncaughtException', e => log('global', 'uncaught:', e?.message));
process.on('unhandledRejection', e => log('global', 'unhandled:', e?.message));

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const body = JSON.stringify({
    ok: true,
    uptime: Math.round(process.uptime()),
    hesaplar: slots.map(s => s.status())
  });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
});

server.listen(PORT, () => log('global', 'keep-alive dinleniyor, port:', PORT));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log('global', 'kapatiliyor...');
    slots.forEach(s => s.destroy());
    server.close();
    setTimeout(() => process.exit(0), 1500);
  });
}