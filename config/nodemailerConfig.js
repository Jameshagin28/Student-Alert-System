import nodemailer from "nodemailer"

// Gmail SMTP configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "user email",
    pass: process.env.GMAIL_APP_PASSWORD || "app password",
  },
})

export async function sendEmail(to, subject, htmlContent) {
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER || "your-email@gmail.com",
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      html: htmlContent,
    }

    const result = await transporter.sendMail(mailOptions)
    console.log("✅ Email sent successfully:", result.messageId)
    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error("❌ Email sending failed:", error)
    return { success: false, error: error.message }
  }
}

export function generateAlertEmailTemplate(alert, recipientName) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .footer { padding: 10px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚨 Academic Alert</h1>
        </div>
        <div class="content">
          <h2>Hello ${recipientName},</h2>
          <h3>${alert.subject}</h3>
          <p>${alert.message}</p>
          <p><strong>Sent:</strong> ${new Date(alert.sent_at).toLocaleString()}</p>
        </div>
        <div class="footer">
          <p>This is an automated message from the Student Alert System.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export function generateEventEmailTemplate(event, recipientName) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .event-details { background: #fff; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .footer { padding: 10px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📅 Upcoming Event</h1>
        </div>
        <div class="content">
          <h2>Hello ${recipientName},</h2>
          <div class="event-details">
            <h3>${event.title}</h3>
            <p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>
            <p><strong>Time:</strong> ${new Date(event.date).toLocaleTimeString()}</p>
            <p><strong>Location:</strong> ${event.location}</p>
            <p><strong>Description:</strong> ${event.description}</p>
          </div>
          <p>We look forward to seeing you there!</p>
        </div>
        <div class="footer">
          <p>This is an automated message from the Student Alert System.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

export async function sendEventNotification(to, event, recipientName) {
  try {
    const subject = `Event Reminder: ${event.title}`
    const htmlContent = generateEventEmailTemplate(event, recipientName)
    
    return await sendEmail(to, subject, htmlContent)
  } catch (error) {
    console.error("❌ Event notification failed:", error)
    return { success: false, error: error.message }
  }
}
