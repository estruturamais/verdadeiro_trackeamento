export async function sha256(value) {
  if (!value) return '';
  const normalized = value.toLowerCase().trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPII(data) {
  const [email, phone, first_name, last_name, city, state, country, zip, external_id] =
    await Promise.all([
      sha256(data.email),
      sha256(data.phone),
      sha256(data.first_name),
      sha256(data.last_name),
      sha256(data.city),
      sha256(data.state),
      sha256(data.country),
      sha256(data.zip),
      sha256(data.external_id)
    ]);

  return { email, phone, first_name, last_name, city, state, country, zip, external_id };
}
