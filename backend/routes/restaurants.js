const router = require('express').Router();

// GET /api/restaurants - 전체 식당 목록
router.get('/', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT 
        r.*,
        COUNT(DISTINCT res.id) FILTER (WHERE res.status = 'confirmed') AS active_reservations
      FROM restaurants r
      LEFT JOIN reservations res ON r.id = res.restaurant_id
      GROUP BY r.id
      ORDER BY r.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/restaurants/:id - 식당 상세 + 메뉴
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [restaurant, menus] = await Promise.all([
      req.db.query('SELECT * FROM restaurants WHERE id = $1', [id]),
      req.db.query('SELECT * FROM menus WHERE restaurant_id = $1 AND available = true ORDER BY price', [id]),
    ]);
    if (!restaurant.rows[0]) return res.status(404).json({ error: '식당을 찾을 수 없습니다' });
    res.json({ ...restaurant.rows[0], menus: menus.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/restaurants/:id/stats - 식당 통계 쿼리 (복잡한 JOIN 예시)
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await req.db.query(`
      SELECT
        r.name AS restaurant_name,
        COUNT(DISTINCT res.id) AS total_reservations,
        SUM(oi.quantity * oi.unit_price) AS total_revenue,
        AVG(res.party_size) AS avg_party_size,
        (
          SELECT m.name FROM menus m
          JOIN order_items oi2 ON m.id = oi2.menu_id
          JOIN reservations res2 ON oi2.reservation_id = res2.id
          WHERE res2.restaurant_id = r.id
          GROUP BY m.id, m.name
          ORDER BY SUM(oi2.quantity) DESC
          LIMIT 1
        ) AS best_selling_menu
      FROM restaurants r
      LEFT JOIN reservations res ON r.id = res.restaurant_id
      LEFT JOIN order_items oi ON res.id = oi.reservation_id
      WHERE r.id = $1
      GROUP BY r.id, r.name
    `, [id]);
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
