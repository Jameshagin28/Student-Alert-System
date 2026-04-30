import express from "express"
import bcrypt from "bcrypt"
import { dbGet, dbRun } from "../db/db.js"
import { generateToken } from "../config/jwtConfig.js"

const router = express.Router()

// Login endpoint
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" })
    }

    // Find user by email
    const user = await dbGet("SELECT * FROM users WHERE email = ?", [email])

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" })
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" })
    }

    // Generate JWT token
    const token = generateToken(user)

    // Log the login
    await dbRun("INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)", [
      user.id,
      "LOGIN",
      `User logged in from IP: ${req.ip}`,
    ])

    // Return user info and token (exclude password)
    const { password: _, ...userWithoutPassword } = user

    res.json({
      success: true,
      user: userWithoutPassword,
      token,
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Token validation endpoint
router.get("/validate", async (req, res) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ error: "No token provided" })
  }

  try {
    const { verifyToken } = await import("../config/jwtConfig.js")
    const decoded = verifyToken(token)

    // Get fresh user data
    const user = await dbGet("SELECT id, email, name, role, department_id FROM users WHERE id = ?", [decoded.id])

    if (!user) {
      return res.status(401).json({ error: "User not found" })
    }

    res.json({ success: true, user })
  } catch (error) {
    res.status(401).json({ error: "Invalid token" })
  }
})

export default router
