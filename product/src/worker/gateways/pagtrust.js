import { parseHotmart } from './hotmart.js';

// Mesmo formato do Hotmart
export function parsePagTrust(body) {
  return parseHotmart(body);
}
