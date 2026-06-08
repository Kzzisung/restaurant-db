const router = require('express').Router();

// GET /api/reservations - 예약 목록 (JOIN 쿼리)
router.get('/', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT
        res.id,
        res.reserved_at,
        res.party_size,
        res.status,
        res.created_at,
        u.name AS user_name,
        u.email AS user_email,
        r.name AS restaurant_name,
        COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_amount,
        COUNT(oi.id) AS item_count
      FROM reservations res
      JOIN users u ON res.user_id = u.id
      JOIN restaurants r ON res.restaurant_id = r.id
      LEFT JOIN order_items oi ON res.id = oi.reservation_id
      GROUP BY res.id, u.name, u.email, r.name
      ORDER BY res.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reservations/:id - 예약 상세
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [reservation, items] = await Promise.all([
      req.db.query(`
        SELECT res.*, u.name AS user_name, r.name AS restaurant_name
        FROM reservations res
        JOIN users u ON res.user_id = u.id
        JOIN restaurants r ON res.restaurant_id = r.id
        WHERE res.id = $1
      `, [id]),
      req.db.query(`
        SELECT oi.*, m.name AS menu_name, (oi.quantity * oi.unit_price) AS subtotal
        FROM order_items oi
        JOIN menus m ON oi.menu_id = m.id
        WHERE oi.reservation_id = $1
      `, [id]),
    ]);
    if (!reservation.rows[0]) return res.status(404).json({ error: '예약을 찾을 수 없습니다' });
    res.json({ ...reservation.rows[0], order_items: items.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reservations - 예약 생성 (트랜잭션 핵심!)
// 트랜잭션 보장 사항:
//   1. 식당 존재 확인
//   2. 해당 시간대 좌석 충분한지 확인 (동시성 제어: FOR UPDATE)
//   3. 예약 INSERT
//   4. 주문 항목 INSERT + 가격 스냅샷
// 모두 성공하거나 모두 롤백
router.post('/', async (req, res) => {
  const client = await req.db.connect();
  try {
    const { user_name, user_email, user_phone, restaurant_id, reserved_at, party_size, order_items } = req.body;

    await client.query('BEGIN');

    // 0. 유저 생성 또는 기존 유저 조회
    const userResult = await client.query(`
      INSERT INTO users (name, email, phone)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [user_name, user_email, user_phone || null]);

    const user_id = userResult.rows[0].id;


    // 1. 식당 좌석 정보 잠금 (동시 예약 충돌 방지)
    const restaurantResult = await client.query(
      'SELECT id, name, total_seats FROM restaurants WHERE id = $1 FOR UPDATE',
      [restaurant_id]
    );
    if (!restaurantResult.rows[0]) {
      throw new Error('식당을 찾을 수 없습니다');
    }

    // 2. 해당 시간대 이미 예약된 좌석 수 확인
    const reservedSeats = await client.query(`
      SELECT COALESCE(SUM(party_size), 0) AS occupied
      FROM reservations
      WHERE restaurant_id = $1
        AND status = 'confirmed'
        AND reserved_at BETWEEN $2::timestamp - INTERVAL '2 hours'
                             AND $2::timestamp + INTERVAL '2 hours'
    `, [restaurant_id, reserved_at]);

    const totalSeats = restaurantResult.rows[0].total_seats;
    const occupied = parseInt(reservedSeats.rows[0].occupied);

    if (occupied + party_size > totalSeats) {
      throw new Error(`좌석 부족: 잔여 ${totalSeats - occupied}석, 요청 ${party_size}석`);
    }

    // 3. 예약 생성
    const reservation = await client.query(`
      INSERT INTO reservations (user_id, restaurant_id, reserved_at, party_size)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [user_id, restaurant_id, reserved_at, party_size]);

    const reservationId = reservation.rows[0].id;

    // 4. 주문 항목 INSERT (메뉴 현재 가격 스냅샷)
    if (order_items && order_items.length > 0) {
      for (const item of order_items) {
        const menuResult = await client.query(
          'SELECT price, available FROM menus WHERE id = $1',
          [item.menu_id]
        );
        if (!menuResult.rows[0] || !menuResult.rows[0].available) {
          throw new Error(`메뉴 ID ${item.menu_id}는 주문할 수 없습니다`);
        }
        await client.query(`
          INSERT INTO order_items (reservation_id, menu_id, quantity, unit_price)
          VALUES ($1, $2, $3, $4)
        `, [reservationId, item.menu_id, item.quantity, menuResult.rows[0].price]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: '예약이 완료되었습니다',
      reservation_id: reservationId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/reservations/:id/cancel - 예약 취소 (트랜잭션)
router.patch('/:id/cancel', async (req, res) => {
  const client = await req.db.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE reservations SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed' RETURNING *`,
      [id]
    );
    if (!result.rows[0]) {
      throw new Error('취소 가능한 예약이 없습니다');
    }

    await client.query('COMMIT');
    res.json({ message: '예약이 취소되었습니다', reservation: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
