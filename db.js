/* db.js - Database Setup (Dexie) */

window.db = new Dexie("CallCenterDB");

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
        // Ignore local changes that haven't been confirmed by server yet to avoid loops
        if (change.doc.metadata.hasPendingWrites) return;

        const data = change.doc.data();
        const docId = isNaN(change.doc.id) ? change.doc.id : parseInt(change.doc.id);

        if (change.type === "added" || change.type === "modified") {
          await db[tableName].put({ ...data, id: docId });

          // Trigger UI updates if app is initialized
          if (window.app) {
            if (tableName === 'tickets' && app.loadTickets) app.loadTickets();
            if (tableName === 'activities' && app.loadActivities) app.loadActivities();
            if (tableName === 'caseNotes' && app.loadCaseNotes) app.loadCaseNotes();
            if (tableName === 'calls' && app.loadRecordings) app.loadRecordings();
            if (app.refreshDashboard) app.refreshDashboard();
          }
        }
        if (change.type === "removed") {
          await db[tableName].delete(docId);
          if (window.app && app.refreshDashboard) app.refreshDashboard();
        }
      });
    });

    // Hook local changes to push to Firestore
    db[tableName].hook('creating', function (id, obj, transaction) {
      // Use a timeout to ensure Dexie has assigned an ID if it's auto-increment
      setTimeout(() => {
        const finalId = id || obj.id;
        if (finalId) {
          firestore.collection(tableName).doc(finalId.toString()).set(obj);
        }
      }, 100);
    });

    db[tableName].hook('updating', function (mods, id, obj, transaction) {
      firestore.collection(tableName).doc(id.toString()).update(mods);
    });

    db[tableName].hook('deleting', function (id, obj, transaction) {
      firestore.collection(tableName).doc(id.toString()).delete();
    });
  };

  // Start Sync for tables
  ['users', 'calls', 'activities', 'tickets', 'caseNotes'].forEach(syncTable);
} else {
  console.error("Firebase not loaded! Ensure scripts in index.html are correct.");
}
