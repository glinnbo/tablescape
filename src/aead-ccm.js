'use strict';
// AES-CCM (RFC 3610) on top of plain AES block encryption, for the IKEA TRÅDFRI gateway's DTLS
// (TLS_PSK_WITH_AES_128_CCM_8). Electron's crypto (BoringSSL) has no CCM, and the DTLS library would otherwise
// need a native module. Stands in for "node-aead-crypto" (same interface); GCM comes from the built-in crypto.
const crypto = require('crypto');

function blockCipher(key) {
  const c = crypto.createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  c.setAutoPadding(false);
  return (block) => c.update(block);
}
function xorInto(a, b, n = 16) { for (let i = 0; i < n; i++) a[i] ^= b[i]; }

function ccmParts(key, nonce, data, aad, tagLen) {
  const E = blockCipher(key);
  const L = 15 - nonce.length; // bytes for the message length
  // CBC-MAC over B0, the additional data and the message
  const b0 = Buffer.alloc(16);
  b0[0] = (aad.length ? 64 : 0) | (((tagLen - 2) / 2) << 3) | (L - 1);
  nonce.copy(b0, 1);
  for (let i = 0, len = data.length; i < L; i++, len = Math.floor(len / 256)) b0[15 - i] = len & 255;
  let x = E(b0);
  const mac = (buf) => { for (let o = 0; o < buf.length; o += 16) { const blk = Buffer.alloc(16); buf.copy(blk, 0, o, Math.min(buf.length, o + 16)); xorInto(blk, x); x = E(blk); } };
  if (aad.length) {
    let head;
    if (aad.length < 0xff00) { head = Buffer.alloc(2); head.writeUInt16BE(aad.length); } else { head = Buffer.alloc(6); head[0] = 0xff; head[1] = 0xfe; head.writeUInt32BE(aad.length, 2); }
    mac(Buffer.concat([head, aad]));
  }
  return { E, L, x, mac: (msg) => { mac(msg); return x; } };
}
function ctr(E, L, nonce, i) {
  const a = Buffer.alloc(16);
  a[0] = L - 1;
  nonce.copy(a, 1);
  for (let k = 0, v = i; k < L; k++, v = Math.floor(v / 256)) a[15 - k] = v & 255;
  return E(a);
}
function crypt(E, L, nonce, buf) {
  const out = Buffer.alloc(buf.length);
  for (let o = 0, i = 1; o < buf.length; o += 16, i++) {
    const s = ctr(E, L, nonce, i);
    for (let k = 0; k < 16 && o + k < buf.length; k++) out[o + k] = buf[o + k] ^ s[k];
  }
  return out;
}

function ccmEncrypt(key, iv, plaintext, aad, authTagLen) {
  const p = ccmParts(key, iv, plaintext, aad, authTagLen);
  const t = p.mac(plaintext);
  const s0 = ctr(p.E, p.L, iv, 0);
  const tag = Buffer.alloc(authTagLen);
  for (let k = 0; k < authTagLen; k++) tag[k] = t[k] ^ s0[k];
  return { ciphertext: crypt(p.E, p.L, iv, plaintext), auth_tag: tag };
}
function ccmDecrypt(key, iv, ciphertext, aad, authTag) {
  const p = ccmParts(key, iv, ciphertext, aad, authTag.length);
  const plaintext = crypt(p.E, p.L, iv, ciphertext);
  const t = p.mac(plaintext);
  const s0 = ctr(p.E, p.L, iv, 0);
  let diff = 0;
  for (let k = 0; k < authTag.length; k++) diff |= (t[k] ^ s0[k]) ^ authTag[k];
  return { plaintext, auth_ok: diff === 0 };
}

function gcmEncrypt(key, iv, plaintext, aad) {
  const c = crypto.createCipheriv(`aes-${key.length * 8}-gcm`, key, iv);
  c.setAAD(aad);
  const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext, auth_tag: c.getAuthTag() };
}
function gcmDecrypt(key, iv, ciphertext, aad, authTag) {
  const d = crypto.createDecipheriv(`aes-${key.length * 8}-gcm`, key, iv);
  d.setAAD(aad); d.setAuthTag(authTag);
  const plaintext = d.update(ciphertext);
  try { d.final(); return { plaintext, auth_ok: true }; } catch { return { plaintext, auth_ok: false }; }
}

module.exports = { ccm: { encrypt: ccmEncrypt, decrypt: ccmDecrypt }, gcm: { encrypt: gcmEncrypt, decrypt: gcmDecrypt } };
