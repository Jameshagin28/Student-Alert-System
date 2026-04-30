import express from "express"
import bcrypt from "bcrypt"
import { dbRun, dbGet, dbAll } from "../db/db.js"
import { authenticateToken, authorizeRoles } from "../config/jwtConfig.js"

const router = express.Router()

// Get users by role (admin only)
router.get("/:role", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { role } = req.params

    if (!["admin", "lecturer", "student"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" })
    }

    const users = await dbAll(
      `
      SELECT u.id, u.email, u.name, u.role, u.created_at, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.role = ?
      ORDER BY u.created_at DESC
    `,
      [role],
    )

    res.json({ success: true, users })
  } catch (error) {
    console.error("Get users error:", error)
    res.status(500).json({ error: "Failed to fetch users" })
  }
})

// Create new user (admin only)
router.post("/", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { email, password, name, role, departmentId, courseId } = req.body

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: "All fields are required" })
    }

    if (!["admin", "lecturer", "student"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" })
    }

    // For students, course is required
    if (role === "student" && !courseId) {
      return res.status(400).json({ error: "Course is required for students" })
    }

    // Check if user already exists
    const existingUser = await dbGet("SELECT id FROM users WHERE email = ?", [email])
    if (existingUser) {
      return res.status(409).json({ error: "User with this email already exists" })
    }

    // Start a transaction
    await dbRun("BEGIN TRANSACTION")

    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10)

      // Create user
      const result = await dbRun(
        "INSERT INTO users (email, password, name, role, department_id) VALUES (?, ?, ?, ?, ?)",
        [email, hashedPassword, name, role, departmentId || null],
      )

      // If student, assign course
      if (role === "student" && courseId) {
        await dbRun(
          "INSERT INTO students_courses (student_id, course_id) VALUES (?, ?)",
          [result.id, courseId]
        )
      }

      // Log the action
      await dbRun("INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)", [
        req.user.id,
        "CREATE_USER",
        `Created ${role}: ${name} (${email})`,
      ])

      await dbRun("COMMIT")

      res.status(201).json({
        success: true,
        userId: result.id,
        message: "User created successfully",
      })
    } catch (error) {
      await dbRun("ROLLBACK")
      throw error
    }
  } catch (error) {
    console.error("Create user error:", error)
    res.status(500).json({ error: "Failed to create user" })
  }
})

// Update user (admin only)
router.put("/:id", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params
    const { email, name, role, departmentId } = req.body

    if (!email || !name || !role) {
      return res.status(400).json({ error: "Email, name, and role are required" })
    }

    // Check if user exists
    const existingUser = await dbGet("SELECT * FROM users WHERE id = ?", [id])
    if (!existingUser) {
      return res.status(404).json({ error: "User not found" })
    }

    // Update user
    await dbRun("UPDATE users SET email = ?, name = ?, role = ?, department_id = ? WHERE id = ?", [
      email,
      name,
      role,
      departmentId || null,
      id,
    ])

    // Log the action
    await dbRun("INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)", [
      req.user.id,
      "UPDATE_USER",
      `Updated user: ${name} (${email})`,
    ])

    res.json({
      success: true,
      message: "User updated successfully",
    })
  } catch (error) {
    console.error("Update user error:", error)
    res.status(500).json({ error: "Failed to update user" })
  }
})

// Delete user (admin only)
router.delete("/:id", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params

    // Check if user exists
    const user = await dbGet("SELECT * FROM users WHERE id = ?", [id])
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Prevent admin from deleting themselves
    if (Number.parseInt(id) === req.user.id) {
      return res.status(400).json({ error: "Cannot delete your own account" })
    }

    // Delete user
    await dbRun("DELETE FROM users WHERE id = ?", [id])

    // Log the action
    await dbRun("INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)", [
      req.user.id,
      "DELETE_USER",
      `Deleted user: ${user.name} (${user.email})`,
    ])

    res.json({
      success: true,
      message: "User deleted successfully",
    })
  } catch (error) {
    console.error("Delete user error:", error)
    res.status(500).json({ error: "Failed to delete user" })
  }
})

// Get courses for lecturer
router.get("/lecturer/:id/courses", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if user can access this data
    if (req.user.role !== "admin" && req.user.id !== Number.parseInt(id)) {
      return res.status(403).json({ error: "Access denied" })
    }

    const courses = await dbAll(
      `
      SELECT 
        c.*, 
        d.name as department_name,
        (SELECT COUNT(*) FROM students_courses sc WHERE sc.course_id = c.id) as student_count
      FROM courses c
      JOIN lecturers_courses lc ON c.id = lc.course_id
      JOIN departments d ON c.department_id = d.id
      WHERE lc.lecturer_id = ?
    `,
      [id],
    )

    res.json({ success: true, courses })
  } catch (error) {
    console.error("Get lecturer courses error:", error)
    res.status(500).json({ error: "Failed to fetch courses" })
  }
})

// Get students for a course
router.get("/course/:courseId/students", authenticateToken, async (req, res) => {
  try {
    const { courseId } = req.params

    // Check if user can access this data
    if (req.user.role !== "admin" && req.user.role !== "lecturer") {
      return res.status(403).json({ error: "Access denied" })
    }

    // If lecturer, verify they teach this course
    if (req.user.role === "lecturer") {
      const teachesCourse = await dbGet(
        "SELECT 1 FROM lecturers_courses WHERE lecturer_id = ? AND course_id = ?",
        [req.user.id, courseId]
      )
      if (!teachesCourse) {
        return res.status(403).json({ error: "You don't teach this course" })
      }
    }

    const students = await dbAll(
      `
      SELECT 
        u.id, u.name, u.email,
        d.name as department_name
      FROM users u
      JOIN students_courses sc ON u.id = sc.student_id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE sc.course_id = ?
      ORDER BY u.name
    `,
      [courseId]
    )

    res.json({ success: true, students })
  } catch (error) {
    console.error("Get course students error:", error)
    res.status(500).json({ error: "Failed to fetch students" })
  }
})

// Get enrolled courses for student
router.get("/student/:id/courses", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Check if user can access this data
    if (req.user.role !== "admin" && req.user.id !== Number.parseInt(id)) {
      return res.status(403).json({ error: "Access denied" })
    }

    const courses = await dbAll(
      `
      SELECT 
        c.*, 
        d.name as department_name,
        u.name as lecturer_name
      FROM courses c
      JOIN students_courses sc ON c.id = sc.course_id
      JOIN departments d ON c.department_id = d.id
      LEFT JOIN lecturers_courses lc ON c.id = lc.course_id
      LEFT JOIN users u ON lc.lecturer_id = u.id
      WHERE sc.student_id = ?
      ORDER BY c.name
    `,
      [id]
    )

    res.json({ success: true, courses })
  } catch (error) {
    console.error("Get student courses error:", error)
    res.status(500).json({ error: "Failed to fetch courses" })
  }
})

export default router
