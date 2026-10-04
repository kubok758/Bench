// Headless Chromium does not read the extra CA certificates Node is told to trust
// (NODE_EXTRA_CA_CERTS), e.g. a TLS-intercepting corporate or sandbox proxy. Pass the
// SPKI hashes of exactly those certificates so Chromium trusts the same set of roots;
// certificate verification itself stays on.
import crypto from 'node:crypto';
import fs from 'node:fs';

export function trustArgs() {
  const file = process.env.NODE_EXTRA_CA_CERTS;
  if (!file || !fs.existsSync(file)) return [];
  const pem = fs.readFileSync(file, 'utf8');
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  const hashes = new Set();
  for (const b of blocks) {
    try {
      const der = new crypto.X509Certificate(b).publicKey.export({ type: 'spki', format: 'der' });
      hashes.add(crypto.createHash('sha256').update(der).digest('base64'));
    } catch { /* skip unparsable entries */ }
  }
  return hashes.size ? [`--ignore-certificate-errors-spki-list=${[...hashes].join(',')}`] : [];
}
