import express from "express"
import { dbRun, dbAll, dbGet } from "../db/db.js"
import { authenticateToken, authorizeRoles } from "../config/jwtConfig.js"
import { sendEmail, generateAlertEmailTemplate } from "../config/nodemailerConfig.js"

const router = express.Router()

// Send alert (lecturers and admins only)
router.post("/send", authenticateToken, authorizeRoles("lecturer", "admin"), async (req, res) => {
  try {
    const { subject, message, recipientType, courseId } = req.body
    const senderId = req.user.id

    if (!subject || !message || !recipientType) {
      return res.status(400).json({ error: "Subject, message, and recipient type are required" })
    }

    // Save alert to database
    const alertResult = await dbRun(
      "INSERT INTO alerts (sender_id, subject, message, recipient_type, course_id) VALUES (?, ?, ?, ?, ?)",
      [senderId, subject, message, recipientType, courseId || null],
    )

    // Get recipients based on type
    let recipients = []

    if (recipientType === "all") {
      recipients = await dbAll("SELECT email, name FROM users WHERE role = 'student'")
    } else if (recipientType === "course" && courseId) {
      recipients = await dbAll(
        `
        SELECT u.email, u.name 
        FROM users u 
        JOIN students_courses sc ON u.id = sc.student_id 
        WHERE sc.course_id = ? AND u.role = 'student'
      `,
        [courseId],
      )
    }

    // Send emails to recipients
    const emailPromises = recipients.map((recipient) => {
      const emailContent = generateAlertEmailTemplate(
        {
          subject,
          message,
          sent_at: new Date(),
        },
        recipient.name,
      )

      return sendEmail(recipient.email, `🚨 ${subject}`, emailContent)
    })

    const emailResults = await Promise.allSettled(emailPromises)
    const successCount = emailResults.filter((result) => result.status === "fulfilled" && result.value.success).length

    // Log the alert sending
    await dbRun("INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)", [
      senderId,
      "SEND_ALERT",
      `Alert sent to ${successCount}/${recipients.length} recipients`,
    ])

    res.json({
      success: true,
      alertId: alertResult.id,
      recipientCount: recipients.length,
      emailsSent: successCount,
    })
  } catch (error) {
    console.error("Send alert error:", error)
    res.status(500).json({ error: "Failed to send alert" })
  }
})

// Get received alerts (students only)
router.get("/received", authenticateToken, authorizeRoles("student"), async (req, res) => {
  try {
    const studentId = req.user.id

    // Get alerts sent to all students or to courses the student is enrolled in
    const alerts = await dbAll(
      `
      SELECT DISTINCT a.*, u.name as sender_name, c.name as course_name
      FROM alerts a
      JOIN users u ON a.sender_id = u.id
      LEFT JOIN courses c ON a.course_id = c.id
      LEFT JOIN students_courses sc ON c.id = sc.course_id AND sc.student_id = ?
      WHERE a.recipient_type = 'all' 
         OR (a.recipient_type = 'course' AND sc.student_id = ?)
      ORDER BY a.sent_at DESC
    `,
      [studentId, studentId],
    )

    res.json({ success: true, alerts })
  } catch (error) {
    console.error("Get received alerts error:", error)
    res.status(500).json({ error: "Failed to fetch alerts" })
  }
})

// Get sent alerts (lecturers and admins only)
router.get("/sent", authenticateToken, authorizeRoles("lecturer", "admin"), async (req, res) => {
  try {
    const senderId = req.user.id
    const userRole = req.user.role

    // For admins, show all alerts. For lecturers, show only their alerts
    const query = userRole === 'admin' 
      ? `
        SELECT a.*, c.name as course_name, u.name as sender_name,
               COUNT(CASE WHEN a.recipient_type = 'all' THEN (SELECT COUNT(*) FROM users WHERE role = 'student')
                          WHEN a.recipient_type = 'course' THEN (SELECT COUNT(*) FROM students_courses WHERE course_id = a.course_id)
                          ELSE 0 END) as recipient_count
        FROM alerts a
        LEFT JOIN courses c ON a.course_id = c.id
        LEFT JOIN users u ON a.sender_id = u.id
        GROUP BY a.id
        ORDER BY a.sent_at DESC
      `
      : `
        SELECT a.*, c.name as course_name,
               COUNT(CASE WHEN a.recipient_type = 'all' THEN (SELECT COUNT(*) FROM users WHERE role = 'student')
                          WHEN a.recipient_type = 'course' THEN (SELECT COUNT(*) FROM students_courses WHERE course_id = a.course_id)
                          ELSE 0 END) as recipient_count
        FROM alerts a
        LEFT JOIN courses c ON a.course_id = c.id
        WHERE a.sender_id = ?
        GROUP BY a.id
        ORDER BY a.sent_at DESC
      `

    const params = userRole === 'admin' ? [] : [senderId]
    const alerts = await dbAll(query, params)

    res.json({ success: true, alerts })
  } catch (error) {
    console.error("Get sent alerts error:", error)
    res.status(500).json({ error: "Failed to fetch sent alerts" })
  }
})

// Get total alerts count
router.get("/count", authenticateToken, authorizeRoles("admin", "lecturer"), async (req, res) => {
  try {
    const userRole = req.user.role
    const userId = req.user.id

    // For admins, count all alerts. For lecturers, count only their alerts
    const query = userRole === 'admin'
      ? "SELECT COUNT(*) as count FROM alerts"
      : "SELECT COUNT(*) as count FROM alerts WHERE sender_id = ?"
    
    const params = userRole === 'admin' ? [] : [userId]
    const result = await dbGet(query, params)

    res.json({ success: true, count: result.count })
  } catch (error) {
    console.error("Get alerts count error:", error)
    res.status(500).json({ error: "Failed to fetch alerts count" })
  }
})

// Delete alert (admin only)
router.delete("/:id", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params

    // Check if alert exists
    const alert = await dbGet("SELECT * FROM alerts WHERE id = ?", [id])
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" })
    }

    // Delete the alert
    await dbRun("DELETE FROM alerts WHERE id = ?", [id])

    // Log the action
    await dbRun(
      "INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)",
      [req.user.id, "DELETE_ALERT", `Deleted alert: ${alert.subject}`]
    )

    res.json({
      success: true,
      message: "Alert deleted successfully"
    })
  } catch (error) {
    console.error("Delete alert error:", error)
    res.status(500).json({ error: "Failed to delete alert" })
  }
})

export default router
