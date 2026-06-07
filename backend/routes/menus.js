const router = require('express').Router();

// GET /api/menus - 전체 메뉴 목록
router.get('/', async (req, res) => {
  try {
    const { restaurant_id } = req.query;
    let query = `
      SELECT m.*, r.name AS restaurant_name
      FROM menus m
      JOIN restaurants r ON m.restaurant_id = r.id
      WHERE m.available = true
    `;
    const params = [];
    if (restaurant_id) {
      query += ` AND m.restaurant_id = $1`;
      params.push(restaurant_id);
    }
    query += ` ORDER BY m.restaurant_id, m.price`;
    const result = await req.db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/menus/popular - 인기 메뉴 (집계 쿼리)
router.get('/popular', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT
        m.id,
        m.name,
        m.price,
        r.name AS restaurant_name,
        SUM(oi.quantity) AS total_ordered,
        SUM(oi.quantity * oi.unit_price) AS total_revenue
      FROM menus m
      JOIN restaurants r ON m.restaurant_id = r.id
      LEFT JOIN order_items oi ON m.id = oi.menu_id
      GROUP BY m.id, m.name, m.price, r.name
      ORDER BY total_ordered DESC NULLS LAST
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
