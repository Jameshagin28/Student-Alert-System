const API_BASE = "http://localhost:3000/api"

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault()

  const email = document.getElementById("email").value
  const password = document.getElementById("password").value
  const loginBtn = document.getElementById("loginBtn")
  const btnText = loginBtn.querySelector(".btn-text")
  const btnLoader = loginBtn.querySelector(".btn-loader")
  const errorMessage = document.getElementById("errorMessage")

  // Show loading state
  loginBtn.disabled = true
  btnText.style.display = "none"
  btnLoader.style.display = "inline"
  errorMessage.style.display = "none"

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    })

    const data = await response.json()

    if (data.success) {
      // Store token and user info
      localStorage.setItem("token", data.token)
      localStorage.setItem("user", JSON.stringify(data.user))

      // Redirect based on role
      switch (data.user.role) {
        case "admin":
          window.location.href = "/admin/pages/dashboard.html"
          break
        case "lecturer":
          window.location.href = "/lecturer/pages/dashboard.html"
          break
        case "student":
          window.location.href = "/student/pages/dashboard.html"
          break
        default:
          throw new Error("Invalid user role")
      }
    } else {
      throw new Error(data.error || "Login failed")
    }
  } catch (error) {
    errorMessage.textContent = error.message
    errorMessage.style.display = "block"
  } finally {
    // Reset button state
    loginBtn.disabled = false
    btnText.style.display = "inline"
    btnLoader.style.display = "none"
  }
})

function fillCredentials(email, password) {
  document.getElementById("email").value = email
  document.getElementById("password").value = password
}

// Check if already logged in
window.addEventListener("load", () => {
  const token = localStorage.getItem("token")
  const user = localStorage.getItem("user")

  if (token && user) {
    const userData = JSON.parse(user)
    // Redirect to appropriate dashboard
    switch (userData.role) {
      case "admin":
        window.location.href = "/admin/pages/dashboard.html"
        break
      case "lecturer":
        window.location.href = "/lecturer/pages/dashboard.html"
        break
      case "student":
        window.location.href = "/student/pages/dashboard.html"
        break
    }
  }
})
