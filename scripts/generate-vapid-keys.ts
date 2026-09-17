import webpush from 'web-push';

/** VAPID 키 쌍 생성: npm run push:keys */
const keys = webpush.generateVAPIDKeys();

process.stdout.write(
  [
    '# .env 에 아래 값을 붙여넣으세요.',
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    'VAPID_SUBJECT=mailto:you@example.com',
    '',
  ].join('\n'),
);
