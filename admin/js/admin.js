const API_BASE = "http://localhost:3000/api"

// Check authentication on page load
document.addEventListener("DOMContentLoaded", () => {
  checkAuth()
  loadUserInfo()
})

async function checkAuth() {
  const token = localStorage.getItem("token")
  const user = localStorage.getItem("user")

  if (!token || !user) {
    window.location.href = "/login/login.html"
    return
  }

  try {
    const userData = JSON.parse(user)
    if (userData.role !== "admin") {
      window.location.href = "/login/login.html"
      return
    }

    // Validate token with server
    const response = await fetch(`${API_BASE}/auth/validate`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error("Token validation failed")
    }
  } catch (error) {
    console.error("Auth check failed:", error)
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    window.location.href = "/login/login.html"
  }
}

function loadUserInfo() {
  const user = localStorage.getItem("user")
  if (user) {
    const userData = JSON.parse(user)
    const adminNameElement = document.getElementById("adminName")
    if (adminNameElement) {
      adminNameElement.textContent = userData.name
    }
  }
}

async function apiCall(endpoint, method = "GET", data = null) {
  const token = localStorage.getItem("token")

  const config = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }

  if (data && method !== "GET") {
    config.body = JSON.stringify(data)
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config)
    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error || "API request failed")
    }

    return result
  } catch (error) {
    console.error("API call failed:", error)

    // Handle authentication errors
    if (error.message.includes("token") || error.message.includes("auth")) {
      localStorage.removeItem("token")
      localStorage.removeItem("user")
      window.location.href = "/login/login.html"
    }

    throw error
  }
}

function logout() {
  if (confirm("Are you sure you want to logout?")) {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    window.location.href = "/login/login.html"
  }
}

function showNotification(message, type = "info") {
  // Remove existing notifications
  const existingNotifications = document.querySelectorAll(".notification")
  existingNotifications.forEach((notification) => notification.remove())

  // Create new notification
  const notification = document.createElement("div")
  notification.className = `notification ${type}`
  notification.textContent = message

  document.body.appendChild(notification)

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove()
    }
  }, 5000)

  // Allow manual removal by clicking
  notification.addEventListener("click", () => {
    notification.remove()
  })
}

// Mobile sidebar toggle
function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar")
  sidebar.classList.toggle("open")
}

// Add mobile menu button if needed
if (window.innerWidth <= 1024) {
  const header = document.querySelector(".content-header")
  if (header) {
    const menuBtn = document.createElement("button")
    menuBtn.innerHTML = "☰"
    menuBtn.className = "btn-secondary mobile-menu-btn"
    menuBtn.onclick = toggleSidebar
    header.insertBefore(menuBtn, header.firstChild)
  }
}

// Handle window resize
window.addEventListener("resize", () => {
  if (window.innerWidth > 1024) {
    const sidebar = document.querySelector(".sidebar")
    sidebar.classList.remove("open")
  }
})

// Utility functions
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatDateTime(dateString) {
  return new Date(dateString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Export for use in other files
window.adminUtils = {
  apiCall,
  showNotification,
  formatDate,
  formatDateTime,
  debounce,
}
