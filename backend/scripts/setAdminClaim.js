#!/usr/bin/env node
/**
 * Grant or revoke admin: true custom claim on a Firebase user.
 *
 * Usage:
 *   node scripts/setAdminClaim.js grant priyashsur@icloud.com
 *   node scripts/setAdminClaim.js revoke priyashsur@icloud.com
 *
 * After running, the user must sign out and sign back in for the
 * new claim to appear in their ID token.
 */
import '../src/config/env.js'
import '../src/config/firebase.js'
import { admin } from '../src/config/firebase.js'

const [, , action, email] = process.argv

if (!['grant', 'revoke'].includes(action) || !email) {
  console.error('Usage: node scripts/setAdminClaim.js <grant|revoke> <email>')
  process.exit(1)
}

const user = await admin.auth().getUserByEmail(email)
await admin.auth().setCustomUserClaims(user.uid, { admin: action === 'grant' })

console.log(`✓ admin claim ${action === 'grant' ? 'granted to' : 'revoked from'} ${email}`)
console.log('  The user must sign out and sign back in for the token to update.')
process.exit(0)
