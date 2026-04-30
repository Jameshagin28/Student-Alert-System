import express from "express"
import { dbAll } from "../db/db.js"
import { authenticateToken, authorizeRoles } from "../config/jwtConfig.js"

const router = express.Router()

// Get recent logs (admin only)
router.get("/recent", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const logs = await dbAll(
      `
      SELECT l.*, u.name as user_name, u.role as user_role
      FROM logs l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.timestamp DESC
      LIMIT 10
    `
    )

    res.json({ success: true, logs })
  } catch (error) {
    console.error("Get logs error:", error)
    res.status(500).json({ error: "Failed to fetch logs" })
  }
})

export default router 