import admin from 'firebase-admin'

const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64

if (!encoded) {
  throw new Error(
    '[firebase] FIREBASE_SERVICE_ACCOUNT_BASE64 is not set.\n' +
    '  1. Firebase Console → Project Settings → Service accounts → Generate new private key\n' +
    '  2. Encode it: base64 -i serviceAccountKey.json | tr -d "\\n"\n' +
    '  3. Paste the result into config/secrets/dev/.env.dev'
  )
}

let serviceAccount
try {
  serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
} catch {
  throw new Error(
    '[firebase] FIREBASE_SERVICE_ACCOUNT_BASE64 could not be decoded.\n' +
    '  Make sure you encoded the JSON with: base64 -i serviceAccountKey.json | tr -d "\\n"\n' +
    '  (the tr -d strips newlines that break base64 decoding)'
  )
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })

export { admin }
