# Project: Client Call & Activity Management System (Local-First)

Meka browser-based web application ekak. Meke data okkoma store wenne oyage computer ekema thiyena IndexedDB eke, Dexie.js haraha.

---

## 🛠️ Technical Stack
* **Frontend:** HTML5, Tailwind CSS (via CDN for simplicity).
* **Logic:** JavaScript (ES6+).
* **Database:** Dexie.js (Wrapper for IndexedDB).
* **Recording API:** Web MediaRecorder API.

---

## 📂 Project Structure
1. `index.html` - The main UI.
2. `style.css` - Custom styles (if needed beyond Tailwind).
3. `db.js` - Database configuration using Dexie.js.
4. `app.js` - Main logic for calls, recording, and ticketing.

---

## 1. Database Schema (Dexie.js)
Meka thamai oyage system eke heart eka. tables 4 k thiyenna ona:
* **users:** Team members login details and roles.
* **activities:** Daily tasks track karanna.
* **calls:** Call recording data, duration, and client details.
* **tickets:** Support tickets.

```javascript
const db = new Dexie("CallCenterDB");
db.version(1).stores({
    users: "++id, name, pin, role",
    calls: "++id, clientName, duration, timestamp, userId, dateString",
    activities: "++id, title, status, timestamp, userId",
    tickets: "++id, description, status, priority, createdAt, userId, callId, dateString"
});
```