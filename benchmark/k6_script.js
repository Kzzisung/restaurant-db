/**
 * k6 벤치마킹 스크립트
 * 식당 예약 시스템 - 4가지 시나리오
 *
 * 실행 방법:
 *   k6 run benchmark/k6_script.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = 'http://localhost:3000/api';

// 커스텀 메트릭
const reservationSuccess = new Rate('reservation_success');
const reservationFail = new Rate('reservation_fail');
const cancelSuccess = new Rate('cancel_success');
const txDuration = new Trend('transaction_duration_ms');

export const options = {
  scenarios: {
    // 시나리오 1: 읽기 부하 테스트
    read_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: 20 },
        { duration: '20s', target: 20 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
      exec: 'readTest',
    },
    // 시나리오 2: 정상 예약 성공률 테스트 (서로 다른 시간대)
    normal_reservation: {
      executor: 'constant-vus',
      vus: 10,
      duration: '20s',
      exec: 'normalReservationTest',
      startTime: '35s',
    },
    // 시나리오 3: 동시 예약 충돌 테스트 (같은 시간대)
    concurrent_reservation: {
      executor: 'constant-vus',
      vus: 30,
      duration: '20s',
      exec: 'concurrentReservationTest',
      startTime: '60s',
    },
    // 시나리오 4: 예약 취소 + 재예약 동시성 테스트
    cancel_and_rebook: {
      executor: 'constant-vus',
      vus: 10,
      duration: '20s',
      exec: 'cancelAndRebookTest',
      startTime: '85s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    transaction_duration_ms: ['p(99)<2000'],
  },
};

// --- 시나리오 1: 읽기 테스트 ---
export function readTest() {
  group('식당 목록 조회', () => {
    const res = http.get(`${BASE_URL}/restaurants`);
    check(res, { '200 OK': (r) => r.status === 200 });
  });
  group('예약 목록 조회', () => {
    const res = http.get(`${BASE_URL}/reservations`);
    check(res, { '200 OK': (r) => r.status === 200 });
  });
  group('인기 메뉴 조회', () => {
    const res = http.get(`${BASE_URL}/menus/popular`);
    check(res, { '200 OK': (r) => r.status === 200 });
  });
  group('식당 통계 조회', () => {
    const rid = Math.ceil(Math.random() * 3);
    const res = http.get(`${BASE_URL}/restaurants/${rid}/stats`);
    check(res, { '200 OK': (r) => r.status === 200 });
  });
  sleep(Math.random() * 0.5 + 0.1);
}

// --- 시나리오 2: 정상 예약 (서로 다른 시간대) ---
export function normalReservationTest() {
  const restaurantId = Math.ceil(Math.random() * 3);
  const menuMap = { 1: [1,2,3], 2: [4,5,6], 3: [7,8,9] };
  const menus = menuMap[restaurantId];
  const hour = 11 + (__VU % 10);
  const reservedAt = `2027-03-${String(10 + __VU % 20).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00`;

  const payload = JSON.stringify({
    user_name: `테스트유저${__VU}`,
    user_email: `testuser${__VU}@benchmark.com`,
    user_phone: `010-0000-${String(__VU).padStart(4,'0')}`,
    restaurant_id: restaurantId,
    reserved_at: reservedAt,
    party_size: Math.ceil(Math.random() * 3) + 1,
    order_items: [{ menu_id: menus[Math.floor(Math.random() * menus.length)], quantity: 1 }],
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/reservations`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  txDuration.add(Date.now() - start);

  const ok = check(res, { '정상 예약 성공 (201)': (r) => r.status === 201 });
  reservationSuccess.add(ok ? 1 : 0);
  reservationFail.add(ok ? 0 : 1);
  sleep(0.5);
}

// --- 시나리오 3: 동시 예약 충돌 (같은 시간대) ---
export function concurrentReservationTest() {
  const payload = JSON.stringify({
    user_name: `충돌테스트${__VU}`,
    user_email: `conflict${__VU}@benchmark.com`,
    restaurant_id: 1,
    reserved_at: '2027-06-15T19:00:00',
    party_size: Math.ceil(Math.random() * 5) + 1,
    order_items: [{ menu_id: 1, quantity: 1 }],
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/reservations`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  txDuration.add(Date.now() - start);

  check(res, {
    '예약 성공 (201)': (r) => r.status === 201,
    '좌석 부족 차단 (400)': (r) => r.status === 400,
  });
  sleep(0.1);
}

// --- 시나리오 4: 취소 + 재예약 동시성 ---
export function cancelAndRebookTest() {
  const hour = String(11 + (__VU % 8)).padStart(2, '0');
  const reservedAt = `2027-09-${String(10 + __VU).padStart(2,'0')}T${hour}:00:00`;

  const createPayload = JSON.stringify({
    user_name: `취소테스트${__VU}`,
    user_email: `cancel${__VU}@benchmark.com`,
    restaurant_id: 2,
    reserved_at: reservedAt,
    party_size: 2,
    order_items: [{ menu_id: 4, quantity: 1 }],
  });

  const createRes = http.post(`${BASE_URL}/reservations`, createPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (createRes.status === 201) {
    const body = JSON.parse(createRes.body);
    const reservationId = body.reservation_id;
    sleep(0.1);

    const start = Date.now();
    const cancelRes = http.patch(`${BASE_URL}/reservations/${reservationId}/cancel`, null, {
      headers: { 'Content-Type': 'application/json' },
    });
    txDuration.add(Date.now() - start);

    const ok = check(cancelRes, { '취소 성공 (200)': (r) => r.status === 200 });
    cancelSuccess.add(ok ? 1 : 0);
  }
  sleep(0.3);
}

// 결과 요약
export function handleSummary(data) {
  const summary = {
    '총 요청 수': data.metrics.http_reqs?.values?.count,
    '평균 응답시간(ms)': data.metrics.http_req_duration?.values?.avg?.toFixed(2),
    'p95 응답시간(ms)': data.metrics.http_req_duration?.values['p(95)']?.toFixed(2),
    'p99 트랜잭션(ms)': data.metrics.transaction_duration_ms?.values['p(99)']?.toFixed(2),
    '정상예약 성공률': (data.metrics.reservation_success?.values?.rate * 100)?.toFixed(2) + '%',
    '취소 성공률': (data.metrics.cancel_success?.values?.rate * 100)?.toFixed(2) + '%',
  };

  console.log('\n======= k6 벤치마킹 결과 요약 =======');
  console.log(JSON.stringify(summary, null, 2));

  return {
    'benchmark/k6_result.json': JSON.stringify(data, null, 2),
  };
}