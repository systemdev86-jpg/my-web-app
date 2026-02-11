/* db.js - Database Setup (Dexie) */

const db = new Dexie("CallCenterDB");

db.version(3).stores({
  users: "++id, name, pin, role",
  calls: "++id, clientName, duration, timestamp, userId, dateString",
  activities: "++id, title, status, timestamp, userId",
  tickets: "++id, description, status, priority, createdAt, userId, callId, dateString, assigneeId, clientName",
  caseNotes: "++id, dateString, caseType, clientName, notes, userId, timestamp"
});

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDIqKGpiklPFvBo_w3aAT9io0ghWn1MCEE",
  authDomain: "misl-erp-support-1.firebaseapp.com",
  projectId: "misl-erp-support-1",
  storageBucket: "misl-erp-support-1.firebasestorage.app",
  messagingSenderId: "850636225848",
  appId: "1:850636225848:web:4d0c2b7475008e1030d5cd"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  const firestore = firebase.firestore();

  // Enable persistence for offline capability
  firestore.enablePersistence().catch(err => console.warn("Persistence failed", err));

  const syncTable = async (tableName) => {
    // Pull updates from Firestore
    firestore.collection(tableName).onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async (change) => {
        const data = change.doc.data();
        const docId = parseInt(change.doc.id);

        if (change.type === "added" || change.type === "modified") {
          await db[tableName].put({ ...data, id: docId });
          // Trigger UI updates if app is initialized
          if (window.app && window.app.refreshDashboard) {
            if (tableName === 'tickets') window.app.loadTickets();
            if (tableName === 'activities') window.app.loadActivities();
            if (tableName === 'caseNotes') window.app.loadCaseNotes();
          }
        }
        if (change.type === "removed") {
          await db[tableName].delete(docId);
        }
      });
    });

    // Hook local changes to push to Firestore
    db[tableName].hook('creating', (id, obj) => {
      const docId = id ? id.toString() : Date.now().toString() + Math.floor(Math.random() * 1000).toString();
      firestore.collection(tableName).doc(docId).set(obj);
    });

    db[tableName].hook('updating', (mods, id) => {
      firestore.collection(tableName).doc(id.toString()).update(mods);
    });

    db[tableName].hook('deleting', (id) => {
      firestore.collection(tableName).doc(id.toString()).delete();
    });
  };

  // Start Sync for tables
  ['users', 'calls', 'activities', 'tickets', 'caseNotes'].forEach(syncTable);
} else {
  console.error("Firebase not loaded! Ensure scripts in index.html are correct.");
}
