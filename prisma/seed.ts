import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { defaultExpiryFor, toKstDateString, travelDateToUtc } from '../src/lib/time';
import { ensureWatchGroup } from '../src/server/monitor/prisma-store';

/**
 * 데모용 시드 데이터.
 *   npm run db:seed
 *
 * 생성되는 알림은 아래 watch token 으로 조회할 수 있다.
 * 브라우저 콘솔에서 다음을 실행하면 "내 알림" 화면에서 그대로 보인다.
 *   localStorage.setItem('ktx-alert.watch-token', 'demo-watch-token-0000000000000000')
 */

const DEMO_TOKEN = 'demo-watch-token-0000000000000000';
const prisma = new PrismaClient();

function tomorrow(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return toKstDateString(date);
}

async function main(): Promise<void> {
  const provider = process.env.TRAIN_PROVIDER ?? 'mock';
  const travelDate = tomorrow();
  const watchTokenHash = createHash('sha256').update(DEMO_TOKEN).digest('hex');

  const user = await prisma.user.upsert({
    where: { watchTokenHash },
    create: { watchTokenHash },
    update: {},
  });

  const routes = [
    { from: 'SEOUL', fromName: '서울', to: 'BUSAN', toName: '부산', start: '17:00', end: '22:00' },
    {
      from: 'YONGSAN',
      fromName: '용산',
      to: 'GWANGJUSONGJEONG',
      toName: '광주송정',
      start: '07:00',
      end: '11:00',
    },
  ];

  for (const route of routes) {
    const groupId = await ensureWatchGroup(prisma, {
      provider,
      departureStationCode: route.from,
      arrivalStationCode: route.to,
      travelDate,
    });

    await prisma.alert.create({
      data: {
        userId: user.id,
        groupId,
        departureStationCode: route.from,
        departureStationName: route.fromName,
        arrivalStationCode: route.to,
        arrivalStationName: route.toName,
        travelDate: travelDateToUtc(travelDate),
        startTime: route.start,
        endTime: route.end,
        passengerCount: 1,
        trainTypes: ['KTX', 'KTX_SANCHEON'],
        seatClasses: ['GENERAL'],
        channels: ['WEB_PUSH'],
        expiresAt: defaultExpiryFor(travelDate),
        memo: 'seed 데이터',
      },
    });
  }

  process.stdout.write(
    [
      `시드 완료: ${routes.length}개 알림 (${travelDate})`,
      '브라우저 콘솔에서 아래를 실행하면 "내 알림" 에서 확인할 수 있습니다.',
      `  localStorage.setItem('ktx-alert.watch-token', '${DEMO_TOKEN}')`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`시드 실패: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
