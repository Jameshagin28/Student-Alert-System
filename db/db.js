import sqlite3 from "sqlite3"
import bcrypt from "bcrypt"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = path.join(__dirname, "../database/student_alert_system.db")
const db = new sqlite3.Database(dbPath)

// Promisify database operations
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err)
      else resolve({ id: this.lastID, changes: this.changes })
    })
  })
}

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err)
      else resolve(row)
    })
  })
}

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

// Initialize database tables
export async function initializeDatabase() {
  try {
    // Users table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT CHECK(role IN ('admin', 'lecturer', 'student')) NOT NULL,
        department_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (department_id) REFERENCES departments(id)
      )
    `)

    // Departments table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Courses table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        description TEXT,
        department_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (department_id) REFERENCES departments(id)
      )
    `)

    // Students-Courses junction table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS students_courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        course_id INTEGER NOT NULL,
        enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES users(id),
        FOREIGN KEY (course_id) REFERENCES courses(id),
        UNIQUE(student_id, course_id)
      )
    `)

    // Lecturers-Courses junction table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS lecturers_courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lecturer_id INTEGER NOT NULL,
        course_id INTEGER NOT NULL,
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lecturer_id) REFERENCES users(id),
        FOREIGN KEY (course_id) REFERENCES courses(id),
        UNIQUE(lecturer_id, course_id)
      )
    `)

    // Alerts table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        recipient_type TEXT CHECK(recipient_type IN ('all', 'course', 'individual')) NOT NULL,
        course_id INTEGER,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (course_id) REFERENCES courses(id)
      )
    `)

    // Events table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        event_date DATETIME NOT NULL,
        event_type TEXT CHECK(event_type IN ('course', 'institution')) NOT NULL,
        course_id INTEGER,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `)

    // Event registrations table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS event_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT CHECK(status IN ('registered', 'attended', 'cancelled')) DEFAULT 'registered',
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(event_id, user_id)
      )
    `)

    // Event notifications table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS event_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        notification_type TEXT CHECK(notification_type IN ('reminder', 'update', 'cancellation')) NOT NULL,
        message TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `)

    // Logs table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `)

    await seedAdminUser()

    console.log("✅ Database initialized successfully")
  } catch (error) {
    console.error("❌ Database initialization failed:", error)
  }
}

async function seedAdminUser() {
  try {
    // Check if admin already exists
    const existingAdmin = await dbGet("SELECT id FROM users WHERE email = 'admin@school.com'")
    if (existingAdmin) return

    // Create default departments
    const departments = [
      ["School of SSET", "SSET"],
      ["School of Law", "LAW"],
      ["School of Education", "EDU"],
      ["School of Accounting", "ACC"],
      ["Admin", "ADM"],
      ["School of Health Sciences", "HSC"]
    ]

    for (const [name, code] of departments) {
      await dbRun("INSERT OR IGNORE INTO departments (name, code) VALUES (?, ?)", [name, code])
    }

    // Get the admin department ID
    const adminDept = await dbGet("SELECT id FROM departments WHERE code = 'ADM'")

    // Create admin user
    const hashedPassword = await bcrypt.hash("Admin@123", 10)
    await dbRun("INSERT INTO users (email, password, name, role, department_id) VALUES (?, ?, ?, ?, ?)", [
      "admin@school.com",
      hashedPassword,
      "System Administrator",
      "admin",
      adminDept.id,
    ])
    console.log("🔑 Admin credentials: admin@school.com / Admin@123")
  } catch (error) {
    console.error("❌ Admin seeding failed:", error)
  }
}

export { db, dbRun, dbGet, dbAll }
