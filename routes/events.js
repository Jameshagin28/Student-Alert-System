import express from "express"
import { dbRun, dbAll } from "../db/db.js"
import { authenticateToken, authorizeRoles } from "../config/jwtConfig.js"
import { sendEventNotification } from "../config/nodemailerConfig.js"

const router = express.Router()

// Create event
router.post("/", authenticateToken, authorizeRoles("admin", "lecturer"), async (req, res) => {
  try {
    const { title, description, eventDate, eventType, courseId } = req.body
    const createdBy = req.user.id

    if (!title || !eventDate || !eventType) {
      return res.status(400).json({ error: "Title, event date, and event type are required" })
    }

    if (!["course", "institution"].includes(eventType)) {
      return res.status(400).json({ error: "Invalid event type" })
    }

    // If course event, courseId is required
    if (eventType === "course" && !courseId) {
      return res.status(400).json({ error: "Course ID is required for course events" })
    }

    const result = await dbRun(
      "INSERT INTO events (title, description, event_date, event_type, course_id, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [title, description || null, eventDate, eventType, courseId || null, createdBy],
    )

    // Log the action
    await dbRun("INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)", [
      createdBy,
      "CREATE_EVENT",
      `Created ${eventType} event: ${title}`,
    ])

    // Get recipients based on event type
    let recipients = []
    if (eventType === "course") {
      // Get students enrolled in the course
      const students = await dbAll(`
        SELECT u.email, u.name
        FROM users u
        JOIN students_courses sc ON u.id = sc.student_id
        WHERE sc.course_id = ?
      `, [courseId])
      recipients = students
    } else {
      // Get all students for institution events
      const students = await dbAll(`
        SELECT email, name
        FROM users
        WHERE role = 'student'
      `)
      recipients = students
    }

    // Send email notifications to all recipients
    const event = {
      title,
      date: eventDate,
      location: eventType === "course" ? "Course-specific location" : "Institution-wide location",
      description: description || "No additional details provided."
    }

    // Send emails in parallel
    const emailPromises = recipients.map(recipient => 
      sendEventNotification(recipient.email, event, recipient.name)
    )

    // Wait for all emails to be sent
    await Promise.all(emailPromises)

    res.status(201).json({
      success: true,
      eventId: result.id,
      message: "Event created successfully and notifications sent",
    })
  } catch (error) {
    console.error("Create event error:", error)
    res.status(500).json({ error: "Failed to create event" })
  }
})

// Get events
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id
    const userRole = req.user.role

    let events = []

    if (userRole === "admin") {
      // Admin can see all events
      events = await dbAll(`
        SELECT e.*, c.name as course_name, u.name as created_by_name
        FROM events e
        LEFT JOIN courses c ON e.course_id = c.id
        JOIN users u ON e.created_by = u.id
        WHERE e.event_date >= date('now')
        ORDER BY e.event_date ASC
      `)
    } else if (userRole === "lecturer") {
      // Lecturer can see institution events and their course events
      events = await dbAll(
        `
        SELECT e.*, c.name as course_name, u.name as created_by_name
        FROM events e
        LEFT JOIN courses c ON e.course_id = c.id
        LEFT JOIN lecturers_courses lc ON c.id = lc.course_id
        JOIN users u ON e.created_by = u.id
        WHERE e.event_date >= date('now')
          AND (e.event_type = 'institution' OR lc.lecturer_id = ?)
        ORDER BY e.event_date ASC
      `,
        [userId],
      )
    } else if (userRole === "student") {
      // Student can see institution events and events for their enrolled courses
      events = await dbAll(
        `
        SELECT e.*, c.name as course_name, u.name as created_by_name
        FROM events e
        LEFT JOIN courses c ON e.course_id = c.id
        LEFT JOIN students_courses sc ON c.id = sc.course_id
        JOIN users u ON e.created_by = u.id
        WHERE e.event_date >= date('now')
          AND (e.event_type = 'institution' OR sc.student_id = ?)
        ORDER BY e.event_date ASC
      `,
        [userId],
      )
    }

    res.json({ success: true, events })
  } catch (error) {
    console.error("Get events error:", error)
    res.status(500).json({ error: "Failed to fetch events" })
  }
})

// Get departments (for dropdowns)
router.get("/departments", authenticateToken, async (req, res) => {
  try {
    const departments = await dbAll("SELECT * FROM departments ORDER BY name")
    res.json({ success: true, departments })
  } catch (error) {
    console.error("Get departments error:", error)
    res.status(500).json({ error: "Failed to fetch departments" })
  }
})

// Get courses (for dropdowns)
router.get("/courses", authenticateToken, async (req, res) => {
  try {
    const courses = await dbAll(`
      SELECT 
        c.*,
        d.name as department_name,
        u.name as lecturer_name,
        (SELECT COUNT(*) FROM students_courses sc WHERE sc.course_id = c.id) as student_count
      FROM courses c
      JOIN departments d ON c.department_id = d.id
      LEFT JOIN lecturers_courses lc ON c.id = lc.course_id
      LEFT JOIN users u ON lc.lecturer_id = u.id
      ORDER BY c.name
    `)
    res.json({ success: true, courses })
  } catch (error) {
    console.error("Get courses error:", error)
    res.status(500).json({ error: "Failed to fetch courses" })
  }
})

// Get single course
router.get("/courses/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const course = await dbAll(`
      SELECT 
        c.*,
        d.name as department_name,
        u.name as lecturer_name,
        u.id as lecturer_id,
        (SELECT COUNT(*) FROM students_courses sc WHERE sc.course_id = c.id) as student_count
      FROM courses c
      JOIN departments d ON c.department_id = d.id
      LEFT JOIN lecturers_courses lc ON c.id = lc.course_id
      LEFT JOIN users u ON lc.lecturer_id = u.id
      WHERE c.id = ?
    `, [id])

    if (!course.length) {
      return res.status(404).json({ error: "Course not found" })
    }

    res.json({ success: true, course: course[0] })
  } catch (error) {
    console.error("Get course error:", error)
    res.status(500).json({ error: "Failed to fetch course" })
  }
})

// Create course
router.post("/courses", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { code, name, department_id, lecturer_id, description } = req.body

    if (!code || !name || !department_id) {
      return res.status(400).json({ error: "Course code, name, and department are required" })
    }

    // Start a transaction
    await dbRun("BEGIN TRANSACTION")

    try {
      // Create the course
      const result = await dbRun(
        "INSERT INTO courses (code, name, department_id) VALUES (?, ?, ?)",
        [code, name, department_id]
      )

      // If lecturer is assigned, create the lecturer-course relationship
      if (lecturer_id) {
        await dbRun(
          "INSERT INTO lecturers_courses (lecturer_id, course_id) VALUES (?, ?)",
          [lecturer_id, result.id]
        )
      }

      // Log the action
      await dbRun(
        "INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)",
        [req.user.id, "CREATE_COURSE", `Created course: ${name} (${code})`]
      )

      await dbRun("COMMIT")

      res.status(201).json({
        success: true,
        courseId: result.id,
        message: "Course created successfully"
      })
    } catch (error) {
      await dbRun("ROLLBACK")
      throw error
    }
  } catch (error) {
    console.error("Create course error:", error)
    res.status(500).json({ error: "Failed to create course" })
  }
})

// Update course
router.put("/courses/:id", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params
    const { code, name, department_id, lecturer_id, description } = req.body

    if (!code || !name || !department_id) {
      return res.status(400).json({ error: "Course code, name, and department are required" })
    }

    // Start a transaction
    await dbRun("BEGIN TRANSACTION")

    try {
      // Update the course
      await dbRun(
        "UPDATE courses SET code = ?, name = ?, department_id = ?, description = ? WHERE id = ?",
        [code, name, department_id, description || null, id]
      )

      // Update lecturer assignment
      await dbRun("DELETE FROM lecturers_courses WHERE course_id = ?", [id])
      if (lecturer_id) {
        await dbRun(
          "INSERT INTO lecturers_courses (lecturer_id, course_id) VALUES (?, ?)",
          [lecturer_id, id]
        )
      }

      // Log the action
      await dbRun(
        "INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)",
        [req.user.id, "UPDATE_COURSE", `Updated course: ${name} (${code})`]
      )

      await dbRun("COMMIT")

      res.json({
        success: true,
        message: "Course updated successfully"
      })
    } catch (error) {
      await dbRun("ROLLBACK")
      throw error
    }
  } catch (error) {
    console.error("Update course error:", error)
    res.status(500).json({ error: "Failed to update course" })
  }
})

// Delete course
router.delete("/courses/:id", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params

    // Start a transaction
    await dbRun("BEGIN TRANSACTION")

    try {
      // Get course info for logging
      const course = await dbAll("SELECT code, name FROM courses WHERE id = ?", [id])
      if (!course.length) {
        return res.status(404).json({ error: "Course not found" })
      }

      // Delete related records first
      await dbRun("DELETE FROM lecturers_courses WHERE course_id = ?", [id])
      await dbRun("DELETE FROM students_courses WHERE course_id = ?", [id])
      await dbRun("DELETE FROM events WHERE course_id = ?", [id])

      // Delete the course
      await dbRun("DELETE FROM courses WHERE id = ?", [id])

      // Log the action
      await dbRun(
        "INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)",
        [req.user.id, "DELETE_COURSE", `Deleted course: ${course[0].name} (${course[0].code})`]
      )

      await dbRun("COMMIT")

      res.json({
        success: true,
        message: "Course deleted successfully"
      })
    } catch (error) {
      await dbRun("ROLLBACK")
      throw error
    }
  } catch (error) {
    console.error("Delete course error:", error)
    res.status(500).json({ error: "Failed to delete course" })
  }
})

// Register for event
router.post("/:id/register", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    // Check if event exists and user is eligible
    const event = await dbAll(
      `SELECT e.*, c.id as course_id 
       FROM events e 
       LEFT JOIN courses c ON e.course_id = c.id 
       WHERE e.id = ?`,
      [id]
    )

    if (!event.length) {
      return res.status(404).json({ error: "Event not found" })
    }

    const eventData = event[0]

    // Check if user is eligible to register
    if (eventData.event_type === "course" && eventData.course_id) {
      const isEnrolled = await dbAll(
        `SELECT 1 FROM students_courses 
         WHERE student_id = ? AND course_id = ?`,
        [userId, eventData.course_id]
      )
      if (!isEnrolled.length) {
        return res.status(403).json({ error: "You are not enrolled in this course" })
      }
    }

    // Register user for event
    await dbRun(
      "INSERT INTO event_registrations (event_id, user_id) VALUES (?, ?)",
      [id, userId]
    )

    // Create notification
    await dbRun(
      "INSERT INTO event_notifications (event_id, user_id, notification_type, message) VALUES (?, ?, ?, ?)",
      [id, userId, "reminder", `You have registered for the event: ${eventData.title}`]
    )

    res.json({
      success: true,
      message: "Successfully registered for event"
    })
  } catch (error) {
    console.error("Event registration error:", error)
    res.status(500).json({ error: "Failed to register for event" })
  }
})

// Update event
router.put("/:id", authenticateToken, authorizeRoles("admin", "lecturer"), async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, eventDate, eventType, courseId } = req.body
    const userId = req.user.id

    // Check if event exists and user has permission
    const event = await dbAll(
      `SELECT * FROM events WHERE id = ?`,
      [id]
    )

    if (!event.length) {
      return res.status(404).json({ error: "Event not found" })
    }

    // Update event
    await dbRun(
      `UPDATE events 
       SET title = ?, description = ?, event_date = ?, event_type = ?, course_id = ?
       WHERE id = ?`,
      [title, description, eventDate, eventType, courseId || null, id]
    )

    // Notify registered users
    const registrations = await dbAll(
      `SELECT user_id FROM event_registrations WHERE event_id = ?`,
      [id]
    )

    for (const reg of registrations) {
      await dbRun(
        `INSERT INTO event_notifications (event_id, user_id, notification_type, message)
         VALUES (?, ?, ?, ?)`,
        [id, reg.user_id, "update", `Event "${title}" has been updated`]
      )
    }

    res.json({
      success: true,
      message: "Event updated successfully"
    })
  } catch (error) {
    console.error("Update event error:", error)
    res.status(500).json({ error: "Failed to update event" })
  }
})

// Delete event
router.delete("/:id", authenticateToken, authorizeRoles("admin", "lecturer"), async (req, res) => {
  try {
    const { id } = req.params

    // Get event details for notifications
    const event = await dbAll(
      `SELECT title FROM events WHERE id = ?`,
      [id]
    )

    if (!event.length) {
      return res.status(404).json({ error: "Event not found" })
    }

    // Get registered users
    const registrations = await dbAll(
      `SELECT user_id FROM event_registrations WHERE event_id = ?`,
      [id]
    )

    // Notify registered users
    for (const reg of registrations) {
      await dbRun(
        `INSERT INTO event_notifications (event_id, user_id, notification_type, message)
         VALUES (?, ?, ?, ?)`,
        [id, reg.user_id, "cancellation", `Event "${event[0].title}" has been cancelled`]
      )
    }

    // Delete event (cascade will handle registrations)
    await dbRun("DELETE FROM events WHERE id = ?", [id])

    res.json({
      success: true,
      message: "Event deleted successfully"
    })
  } catch (error) {
    console.error("Delete event error:", error)
    res.status(500).json({ error: "Failed to delete event" })
  }
})

// Get event registrations
router.get("/:id/registrations", authenticateToken, authorizeRoles("admin", "lecturer"), async (req, res) => {
  try {
    const { id } = req.params

    const registrations = await dbAll(
      `SELECT er.*, u.name as user_name, u.email
       FROM event_registrations er
       JOIN users u ON er.user_id = u.id
       WHERE er.event_id = ?
       ORDER BY er.registered_at DESC`,
      [id]
    )

    res.json({
      success: true,
      registrations
    })
  } catch (error) {
    console.error("Get registrations error:", error)
    res.status(500).json({ error: "Failed to fetch registrations" })
  }
})

// Get user's event notifications
router.get("/notifications", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id

    const notifications = await dbAll(
      `SELECT en.*, e.title as event_title
       FROM event_notifications en
       JOIN events e ON en.event_id = e.id
       WHERE en.user_id = ?
       ORDER BY en.sent_at DESC
       LIMIT 50`,
      [userId]
    )

    res.json({
      success: true,
      notifications
    })
  } catch (error) {
    console.error("Get notifications error:", error)
    res.status(500).json({ error: "Failed to fetch notifications" })
  }
})

// Mark notification as read
router.put("/notifications/:id/read", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    await dbRun(
      `UPDATE event_notifications 
       SET read_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [id, userId]
    )

    res.json({
      success: true,
      message: "Notification marked as read"
    })
  } catch (error) {
    console.error("Mark notification read error:", error)
    res.status(500).json({ error: "Failed to mark notification as read" })
  }
})

export default router
